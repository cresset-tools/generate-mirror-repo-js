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
} = require('./../build-config/modulargento-release-build-config');
const {fetchPackagistList} = require('../packagist');
const buildState = require('../type/build-state');
const packageDefinition = require('../type/package-definition');

const options = parseOptions(
  `$outputDir $gitRepoDir $repoUrl $mageosVendor $mageosRelease $upstreamRelease @help|h`,
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

mageosRelease && validateVersionString(mageosRelease, 'mageosRelease');
upstreamRelease && validateVersionString(upstreamRelease, 'upstreamRelease');

if (! mageosRelease) {
  throw new Error(`--mageosRelease is required (e.g. --mageosRelease=3.0.0)`);
}
if (upstreamRelease && ! mageosRelease) {
  throw new Error(`An upstream release may only be specified when building a new release`);
}

const distroRelease = new buildState({
  version: mageosRelease,
  composerRepoUrl: mageosRepoUrl,
  fallbackVersion: mageosRelease,
  dependencyVersions: {'*': mageosRelease}
});

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

(async () => {
  try {
    await fetchPackagistList(mageosVendor);

    console.log(`Building ${mageosVendor} release ${mageosRelease}`);
    const upstreamVersionMap = upstreamRelease
      ? await getPackageVersionMap(upstreamRelease)
      : {};

    distroRelease.replaceVersions = upstreamVersionMap;

    for (const instruction of releaseInstructions) {
      instruction.vendor = mageosVendor;

      // Prepare the release on a work branch (vendor rename + version pin +
      // replace map written into composer.json), commit it locally, and build
      // from that branch. We intentionally skip createTagForRef: the source
      // repo already carries an inherited tag and we do not publish source tags.
      const workBranch = await prepRelease(instruction, distroRelease);
      await repo.addUpdated(instruction.repoUrl, `'*composer.json'`);
      await repo.commit(instruction.repoUrl, workBranch, `Release ${mageosRelease}`);

      distroRelease.origRef = instruction.ref;
      instruction.ref = workBranch;
      await processBuildInstructions(instruction, distroRelease);
    }

    await buildModulesAtOwnVersions();
  } catch (exception) {
    console.log(exception);
    throw exception;
  }
})();
