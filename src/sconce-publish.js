// Publish generated package archives to a sconce Composer repository, in place
// of building a satis repository from them.
//
// Each archive's composer.json names the package and version. A version the
// repository already serves is skipped, so a run that rebuilds every release
// only uploads the new ones. The rest are unpacked (keeping file modes) and
// handed to `sconce publish`, which archives the tree itself. sconce never
// changes a published version: the same contents again answer "exists", and
// different contents are refused, so a version can never be replaced under the
// lock files that pin it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const JSZip = require('jszip');

/** Every `.zip` under `dir`, sorted, as absolute paths. */
function findArchives(dir) {
  const out = [];
  const walk = d => {
    for (const entry of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith('.zip')) out.push(p);
    }
  };
  walk(path.resolve(dir));
  return out.sort();
}

/** The `{name, version}` an archive declares in its root composer.json. */
async function readArchive(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const composerJson = zip.file('composer.json');
  if (!composerJson) throw new Error(`${file}: no composer.json at the archive root`);
  const {name, version} = JSON.parse(await composerJson.async('string'));
  if (!name || !version) throw new Error(`${file}: composer.json has no name or version`);
  return {zip, name, version};
}

/** Write a zip's entries under `dir`, with their unix permissions. */
async function extractTo(zip, dir) {
  for (const entry of Object.values(zip.files)) {
    const target = path.join(dir, entry.name);
    if (!target.startsWith(dir + path.sep)) throw new Error(`unsafe path in archive: ${entry.name}`);
    if (entry.dir) {
      fs.mkdirSync(target, {recursive: true});
      continue;
    }
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, await entry.async('nodebuffer'));
    const mode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions & 0o777 : 0o644;
    fs.chmodSync(target, mode);
  }
}

/**
 * The versions `repo` already serves for `name`, or an empty set when it
 * cannot tell (no such package yet, or it needs a credential).
 */
async function servedVersions(sconceUrl, repo, name, fetchImpl = fetch) {
  const res = await fetchImpl(`${sconceUrl.replace(/\/$/, '')}/${repo}/p2/${name}.json`);
  if (!res.ok) return new Set();
  const doc = await res.json();
  return new Set((doc.packages?.[name] || []).map(v => v.version));
}

/** Run `sconce publish` for one unpacked package; resolves to its exit code. */
function runSconce(args, sconceBin) {
  return new Promise(resolve => {
    const child = spawn(sconceBin, args, {stdio: 'inherit'});
    child.on('close', code => resolve(code ?? 1));
    child.on('error', err => {
      console.error(`could not run ${sconceBin}: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Publish every archive under `packagesDir` that `repo` does not serve yet.
 * Returns `{published, skipped, failed}`, `failed` naming each archive.
 */
async function publishArchives({packagesDir, sconceUrl, repo, visibility = 'public', sconceBin = 'sconce', concurrency = 4, fetchImpl = fetch, run = runSconce}) {
  const archives = findArchives(packagesDir);
  const served = new Map();
  const result = {published: 0, skipped: 0, failed: []};
  let next = 0;

  const worker = async () => {
    while (next < archives.length) {
      const file = archives[next++];
      let tmp;
      try {
        const {zip, name, version} = await readArchive(file);
        if (!served.has(name)) served.set(name, servedVersions(sconceUrl, repo, name, fetchImpl));
        if ((await served.get(name)).has(version)) {
          result.skipped++;
          continue;
        }
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sconce-publish-'));
        await extractTo(zip, tmp);
        const code = await run(
          ['publish', tmp, '--repo', repo, '--url', sconceUrl, '--version', version, '--visibility', visibility],
          sconceBin
        );
        if (code === 0) result.published++;
        else result.failed.push(`${name} ${version} (${path.basename(file)})`);
      } catch (e) {
        result.failed.push(`${path.basename(file)}: ${e.message}`);
      } finally {
        if (tmp) fs.rmSync(tmp, {recursive: true, force: true});
      }
    }
  };
  await Promise.all(Array.from({length: Math.max(1, concurrency)}, worker));
  return result;
}

module.exports = {findArchives, readArchive, extractTo, servedVersions, publishArchives};
