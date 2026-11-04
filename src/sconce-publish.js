// Publish generated package archives to a sconce Composer repository, in place
// of building a satis repository from them.
//
// Each archive's composer.json names the package and version. sconce never
// changes a published version, so a version the repository already serves is
// compared with the new build instead of published: the same files again are
// skipped, so a run that rebuilds every release only uploads the new ones,
// while different files fail the run. A changed build needs a new version;
// publishing it under the old one would change what lock files already pin.
// The rest are unpacked (keeping file modes) and handed to `sconce publish`,
// which archives the tree itself.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');
const crypto = require('crypto');
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
 * The versions `repo` already serves for `name`, as a map of version to dist
 * URL, or an empty map when it cannot tell (no such package yet, or it needs
 * a credential).
 */
async function servedVersions(sconceUrl, repo, name, fetchImpl = fetch) {
  const res = await fetchImpl(`${sconceUrl.replace(/\/$/, '')}/${repo}/p2/${name}.json`);
  if (!res.ok) return new Map();
  const doc = await res.json();
  return new Map((doc.packages?.[name] || []).map(v => [v.version, v.dist?.url]));
}

/**
 * What a package archive contains, ignoring how it was zipped: each file's
 * path (relative to the composer.json, since Composer accepts a single top
 * directory), a hash of its bytes and whether it is executable. Timestamps,
 * entry order and compression differ between satis, the generator and
 * sconce's own archiver without changing what Composer installs.
 */
async function archiveContents(zip) {
  const files = Object.values(zip.files).filter(e => !e.dir);
  const manifest = files.find(e => e.name === 'composer.json')
    || files.find(e => /^[^/]+\/composer\.json$/.test(e.name));
  const prefix = manifest ? manifest.name.slice(0, -'composer.json'.length) : '';
  const out = new Map();
  for (const entry of files) {
    if (!entry.name.startsWith(prefix)) continue;
    const hash = crypto.createHash('sha256').update(await entry.async('nodebuffer')).digest('hex');
    const exec = typeof entry.unixPermissions === 'number' ? (entry.unixPermissions & 0o111) !== 0 : null;
    out.set(entry.name.slice(prefix.length), {hash, exec});
  }
  return out;
}

/** The first difference between two `archiveContents`, or null when they match. */
function contentsDiffer(built, served) {
  for (const [p, b] of built) {
    const s = served.get(p);
    if (!s) return `${p} is new`;
    if (s.hash !== b.hash) return `${p} changed`;
    // A zip made without unix attributes cannot say; only compare known modes.
    if (s.exec !== null && b.exec !== null && s.exec !== b.exec) return `${p} changed mode`;
  }
  for (const p of served.keys()) if (!built.has(p)) return `${p} was removed`;
  return null;
}

/** Download a served dist and read what it contains. */
async function servedContents(url, fetchImpl = fetch) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`downloading ${url}: HTTP ${res.status}`);
  return archiveContents(await JSZip.loadAsync(Buffer.from(await res.arrayBuffer())));
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
 * Publish every archive under `packagesDir` that `repo` does not serve yet,
 * and check the rest match what it serves. Returns `{published, skipped,
 * failed}`, `failed` naming each archive that was refused, unreadable or
 * different from the published version.
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
        const versions = await served.get(name);
        if (versions.has(version)) {
          const diff = contentsDiffer(await archiveContents(zip), await servedContents(versions.get(version), fetchImpl));
          if (diff) result.failed.push(`${name} ${version} differs from the published version (${diff}); publish it as a new version`);
          else result.skipped++;
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

module.exports = {findArchives, readArchive, extractTo, servedVersions, archiveContents, contentsDiffer, publishArchives};
