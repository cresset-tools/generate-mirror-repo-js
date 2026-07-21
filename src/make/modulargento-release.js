const fs = require('fs');
const path = require('path');
const repo = require('./../repository');
const parseOptions = require('parse-options');
const {
  getPackageVersionMap,
  prepRelease,
  processBuildInstructions,
  validateVersionString,
} = require('./../release-build-tools');
const {
  setArchiveBaseDir,
  createPackageForRef,
  getLatestTag,
  readComposerJson,
} = require('../package-modules');
const {
  buildConfig: releaseInstructions,
  moduleBuildConfig,
  previousReleases,
} = require('./../build-config/modulargento-release-build-config');
const {fetchPackagistList} = require('../packagist');
const buildState = require('../type/build-state');
const packageDefinition = require('../type/package-definition');

const options = parseOptions(
  `$outputDir $gitRepoDir $repoUrl $mageosVendor $mageosRelease $upstreamRelease $releaseRefsFile @skipHistory @help|h`,
  process.argv
);

if (options.help) {
  console.log(`Build a Modulargento release from the cresset-tools forks.

Releases the cresset-tools/modulargento-magento2 monorepo at --mageosRelease
(vendor renamed to --mageosVendor, dependency-compatible with the upstream
Magento Open Source release --upstreamRelease via the composer "replace" map),
plus the standalone module forks at their own versions. Publishes to --repoUrl.

Unlike the Mage-OS release flow this does NOT create or push git tags on the
source repos (the monorepo fork already carries an inherited tag): packages are
built from the committed prep work-branch.

Usage:
  node src/make/modulargento-release.js [OPTIONS]

Options:
  --outputDir=       Dir to contain the built packages (default: packages)
  --gitRepoDir=      Dir to clone repositories into (default: repositories)
  --repoUrl=         Composer repository URL to embed (default: https://modulargento.cresset.tools/)
  --mageosVendor=    Composer release vendor-name (default: modulargento)
  --mageosRelease=   Target release version (e.g. 3.0.0)
  --upstreamRelease= Upstream Magento Open Source release for compatibility (e.g. 2.4.8)
  --releaseRefsFile= JS file mapping instruction key -> git ref for the target
                     release (default: build-config/<vendor>-release-refs/<version>.js)
  --skipHistory      Build only --mageosRelease; skip rebuilding the previous
                     releases (from build-config/modulargento-release-build-config
                     previousReleases) into the same output.
`);
  process.exit(1);
}

const archiveDir = options.outputDir || 'packages';
setArchiveBaseDir(archiveDir);

if (options.gitRepoDir) {
  repo.setStorageDir(options.gitRepoDir);
}

const mageosRelease = options.mageosRelease || '';
const mageosVendor = options.mageosVendor || 'modulargento';
const mageosRepoUrl = options.repoUrl || 'https://modulargento.cresset.tools/';
const upstreamRelease = options.upstreamRelease || '';
const skipHistory = !!options.skipHistory;

mageosRelease && validateVersionString(mageosRelease, 'mageosRelease');
upstreamRelease && validateVersionString(upstreamRelease, 'upstreamRelease');

if (! mageosRelease) {
  throw new Error(`--mageosRelease is required (e.g. --mageosRelease=3.0.0)`);
}
if (upstreamRelease && ! mageosRelease) {
  throw new Error(`An upstream release may only be specified when building a new release`);
}

// The default per-instruction refs (config values), captured before any build
// mutates instruction.ref to a prep work-branch. A release without a pinned ref
// for a given instruction falls back to this default.
const defaultRefs = new Map(releaseInstructions.map(i => [i.key, i.ref]));

/**
 * Load the instruction-key -> git-ref map that pins a release's sources, so an
 * older release stays reproducible after the monorepo `main` advances. Mirrors
 * mageos-release.js: build-config/<vendor>-release-refs/<version>.js.
 */
function loadReleaseRefs(version) {
  const refsFile = (version === mageosRelease && options.releaseRefsFile)
    ? options.releaseRefsFile
    : path.join(__dirname, `./../build-config/${mageosVendor}-release-refs/${version}.js`);
  return fs.existsSync(refsFile) ? require(refsFile) : {};
}

/**
 * Build the standalone module forks at their own versions (not lockstep).
 * Each is a single-package repo; version comes from the latest git tag, or
 * the composer.json version for repos without tags. Package names are kept
 * as-is (no vendor rename, no replace map).
 */
async function buildModulesAtOwnVersions() {
  for (const moduleInstruction of moduleBuildConfig) {
    const {repoUrl, ref} = moduleInstruction;
    const pkg = new packageDefinition(moduleInstruction.packageIndividual[0]);

    let version = await getLatestTag(repoUrl);
    if (! version) {
      const composerJson = JSON.parse(await readComposerJson(repoUrl, pkg.dir, ref));
      version = composerJson.version || '';
    }
    if (! version) {
      throw new Error(`Unable to determine a version for ${repoUrl} (no tags and no composer.json version)`);
    }
    console.log(`Building ${moduleInstruction.key} at version ${version}`);

    const moduleRelease = new buildState({
      ref,
      version,
      composerRepoUrl: mageosRepoUrl,
      fallbackVersion: version,
      dependencyVersions: {},
    });
    await repo.pull(repoUrl, ref);
    // No vendor rename for module forks: they keep their own package names and
    // deps (magento/* deps resolve via the monorepo packages' `replace` map).
    // `transform: {}` is required by createPackageForRef's transform lookup.
    await createPackageForRef({repoUrl, ref, key: moduleInstruction.key, transform: {}}, pkg, moduleRelease);
    repo.clearCache();
  }
}

/**
 * Build one lockstep release of the monorepo + infra forks into the shared
 * output. `releaseVersion`/`upstream` name the version + the Magento OSS release
 * its `replace` map targets. Sources are pinned per instruction from the
 * version's release-refs file (falling back to the config default), so an older
 * release keeps building after `main` advances.
 */
async function buildRelease(releaseVersion, upstream) {
  console.log(`Building ${mageosVendor} release ${releaseVersion}`);
  const releaseRefs = loadReleaseRefs(releaseVersion);

  const distroRelease = new buildState({
    version: releaseVersion,
    composerRepoUrl: mageosRepoUrl,
    fallbackVersion: releaseVersion,
    dependencyVersions: {'*': releaseVersion},
  });
  distroRelease.replaceVersions = upstream ? await getPackageVersionMap(upstream) : {};

  for (const instruction of releaseInstructions) {
    instruction.vendor = mageosVendor;
    // Reset the source ref each release (a prior release mutated it to a prep
    // branch): pin from the release-refs map, else the captured config default.
    instruction.ref = releaseRefs[instruction.key]
      || releaseRefs['*']
      || defaultRefs.get(instruction.key);

    // Prepare the release on a work branch (vendor rename + version pin +
    // replace map written into composer.json), commit it locally, and build
    // from that branch. We intentionally skip createTagForRef: the source
    // repo already carries an inherited tag and we do not publish source tags.
    const workBranch = await prepRelease(instruction, distroRelease);
    await repo.addUpdated(instruction.repoUrl, `'*composer.json'`);
    await repo.commit(instruction.repoUrl, workBranch, `Release ${releaseVersion}`);

    distroRelease.origRef = instruction.ref;
    instruction.ref = workBranch;
    await processBuildInstructions(instruction, distroRelease);
  }
}

(async () => {
  try {
    await fetchPackagistList(mageosVendor);

    // Rebuild the previous releases into the same output first (unless skipped),
    // then the target release. satis (artifact repo, require-all) aggregates
    // every version present in build/packages, so all releases stay published.
    if (! skipHistory) {
      for (const prev of (previousReleases || [])) {
        if (prev.version === mageosRelease) continue; // don't double-build the target
        await buildRelease(prev.version, prev.upstreamRelease || '');
      }
    }

    await buildRelease(mageosRelease, upstreamRelease);

    // Standalone module forks are published at their own tag versions (identical
    // across releases → satis dedups), so build them once, last.
    await buildModulesAtOwnVersions();
  } catch (exception) {
    console.log(exception);
    throw exception;
  }
})();
