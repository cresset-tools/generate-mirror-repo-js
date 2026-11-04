const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const {publishArchives, findArchives, archiveContents} = require('../../src/sconce-publish');

async function writeArchive(dir, name, version, files = {}) {
  const zip = new JSZip();
  zip.file('composer.json', JSON.stringify({name, version}), {unixPermissions: '644'});
  for (const [p, [content, mode]] of Object.entries(files)) {
    zip.file(p, content, {unixPermissions: mode});
  }
  const file = path.join(dir, name + '-' + version + '.zip');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, await zip.generateAsync({type: 'nodebuffer', platform: 'UNIX'}));
  return file;
}

// A fake sconce: `versionsByName` maps a package to {version: dist zip bytes}.
const served = versionsByName => async url => {
  if (url.includes('/dist/')) {
    const [name, version] = decodeURIComponent(url.split('/dist/')[1]).split('@');
    const bytes = versionsByName[name][version];
    return {ok: true, status: 200, arrayBuffer: async () => bytes};
  }
  const name = url.split('/p2/')[1].replace(/\.json$/, '');
  const versions = versionsByName[name];
  if (!versions) return {ok: false, json: async () => ({})};
  return {ok: true, json: async () => ({packages: {[name]: Object.keys(versions).map(version => (
    {version, dist: {type: 'zip', url: `https://repo.example.org/dist/${encodeURIComponent(name + '@' + version)}`}}
  ))}})};
};

async function zipBytes(entries, opts = {}) {
  const zip = new JSZip();
  for (const [p, [content, mode]] of Object.entries(entries)) zip.file(p, content, {unixPermissions: mode, date: opts.date});
  return zip.generateAsync({type: 'nodebuffer', platform: 'UNIX', compression: opts.compression || 'STORE'});
}

describe('publishArchives', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sconce-publish-test-'));
  });
  afterEach(() => fs.rmSync(dir, {recursive: true, force: true}));

  test('publishes only versions the repository does not serve, unpacked with their modes', async () => {
    await writeArchive(dir, 'mage-os/module-a', '1.0.0');
    await writeArchive(dir, 'mage-os/module-a', '1.1.0', {'bin/run': ['#!/bin/sh', '755'], 'src/A.php': ['<?php', '644']});
    await writeArchive(dir, 'mage-os/module-b', '2.0.0');
    const calls = [];
    const run = async args => {
      const pkgDir = args[1];
      const composer = JSON.parse(fs.readFileSync(path.join(pkgDir, 'composer.json'), 'utf8'));
      const modes = {};
      for (const f of ['bin/run', 'src/A.php']) {
        const p = path.join(pkgDir, f);
        if (fs.existsSync(p)) modes[f] = (fs.statSync(p).mode & 0o777).toString(8);
      }
      calls.push({args: args.slice(2), name: composer.name, modes});
      return 0;
    };

    const result = await publishArchives({
      packagesDir: dir,
      sconceUrl: 'https://repo.example.org/',
      repo: 'mage-os/releases',
      // 1.0.0 is published with the same files, zipped differently.
      fetchImpl: served({'mage-os/module-a': {'1.0.0': await zipBytes(
        {'composer.json': [JSON.stringify({name: 'mage-os/module-a', version: '1.0.0'}), '644']},
        {date: new Date('2020-01-01'), compression: 'DEFLATE'},
      )}}),
      run,
      concurrency: 1,
    });

    expect(result).toEqual({published: 2, skipped: 1, failed: []});
    const a = calls.find(c => c.name === 'mage-os/module-a');
    expect(a.args).toEqual(['--repo', 'mage-os/releases', '--url', 'https://repo.example.org/', '--version', '1.1.0', '--visibility', 'public']);
    expect(a.modes).toEqual({'bin/run': '755', 'src/A.php': '644'});
    expect(calls.find(c => c.name === 'mage-os/module-b').args).toContain('2.0.0');
    // The unpacked trees are cleaned up.
    expect(fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('sconce-publish-') && !d.startsWith('sconce-publish-test-'))
      .some(d => fs.existsSync(path.join(os.tmpdir(), d, 'composer.json')))).toBe(false);
  });

  test('reports a refused publish and an unreadable archive, and carries on', async () => {
    await writeArchive(dir, 'mage-os/module-a', '1.0.0');
    await writeArchive(dir, 'mage-os/module-b', '1.0.0');
    fs.writeFileSync(path.join(dir, 'mage-os', 'broken.zip'), 'not a zip');
    const result = await publishArchives({
      packagesDir: dir,
      sconceUrl: 'https://repo.example.org',
      repo: 'o/r',
      fetchImpl: served({}),
      // sconce refuses module-a, e.g. different contents for a published version.
      run: async args => (fs.readFileSync(path.join(args[1], 'composer.json'), 'utf8').includes('module-a') ? 1 : 0),
    });
    expect(result.published).toBe(1);
    expect(result.failed).toHaveLength(2);
    expect(result.failed.join('\n')).toMatch(/mage-os\/module-a 1\.0\.0/);
    expect(result.failed.join('\n')).toMatch(/broken\.zip/);
  });

  test('fails a rebuilt version whose files differ from the published one', async () => {
    await writeArchive(dir, 'mage-os/module-a', '1.0.0', {'src/A.php': ['<?php // new', '644']});
    await writeArchive(dir, 'mage-os/module-b', '1.0.0', {'bin/run': ['#!/bin/sh', '755']});
    const composer = name => [JSON.stringify({name, version: '1.0.0'}), '644'];
    const calls = [];
    const result = await publishArchives({
      packagesDir: dir,
      sconceUrl: 'https://repo.example.org',
      repo: 'o/r',
      fetchImpl: served({
        'mage-os/module-a': {'1.0.0': await zipBytes({'composer.json': composer('mage-os/module-a'), 'src/A.php': ['<?php // old', '644']})},
        'mage-os/module-b': {'1.0.0': await zipBytes({'composer.json': composer('mage-os/module-b'), 'bin/run': ['#!/bin/sh', '644']})},
      }),
      run: async args => (calls.push(args), 0),
    });
    expect(calls).toEqual([]);
    expect(result.published).toBe(0);
    expect(result.failed.sort()).toEqual([
      'mage-os/module-a 1.0.0 differs from the published version (src/A.php changed); publish it as a new version',
      'mage-os/module-b 1.0.0 differs from the published version (bin/run changed mode); publish it as a new version',
    ]);
  });

  test('reads contents relative to the composer.json, ignoring a top directory', async () => {
    const flat = await archiveContents(await JSZip.loadAsync(await zipBytes({'composer.json': ['{}', '644'], 'a/b.php': ['x', '644']})));
    const nested = await archiveContents(await JSZip.loadAsync(await zipBytes({'pkg-1.0/composer.json': ['{}', '644'], 'pkg-1.0/a/b.php': ['x', '644']})));
    expect([...nested]).toEqual([...flat]);
    expect([...flat.keys()].sort()).toEqual(['a/b.php', 'composer.json']);
  });

  test('finds archives recursively, in a stable order', async () => {
    await writeArchive(dir, 'b/pkg', '1.0.0');
    await writeArchive(dir, 'a/pkg', '1.0.0');
    expect(findArchives(dir).map(f => path.relative(dir, f))).toEqual(['a/pkg-1.0.0.zip', 'b/pkg-1.0.0.zip']);
  });
});
