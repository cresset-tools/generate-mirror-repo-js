// Publish the generated package archives to a sconce repository instead of
// building a satis repository. See src/sconce-publish.js.

const parseOptions = require('parse-options');
const {publishArchives} = require('../src/sconce-publish');

const options = parseOptions(
  `$packagesDir $sconceUrl $sconceRepo $visibility $sconceBin $concurrency @help|h`,
  process.argv
);

if (options.help || !options.sconceUrl || !options.sconceRepo) {
  console.log(`Publish generated Composer packages to a sconce repository.

Usage:
  node bin/publish-to-sconce.js --sconceUrl=https://repo.example.org --sconceRepo=org/repo [OPTIONS]

Options:
  --packagesDir=  Dir holding the built package archives (default: packages)
  --sconceUrl=    Base URL of the sconce server
  --sconceRepo=   Target repository, as <org>/<repo>
  --visibility=   public (may be redistributed, the default) or private
  --sconceBin=    The sconce binary (default: sconce on PATH)
  --concurrency=  Archives published at once (default: 4)

Authentication is sconce publish's own: SCONCE_PUBLISH_TOKEN, or the CI OIDC
exchange when running in GitHub Actions or GitLab CI.
`);
  process.exit(options.help ? 0 : 1);
}

publishArchives({
  packagesDir: options.packagesDir || 'packages',
  sconceUrl: options.sconceUrl,
  repo: options.sconceRepo,
  visibility: options.visibility || 'public',
  sconceBin: options.sconceBin || 'sconce',
  concurrency: Number(options.concurrency) || 4,
}).then(({published, skipped, failed}) => {
  console.log(`sconce: ${published} published, ${skipped} already served, ${failed.length} failed`);
  for (const f of failed) console.error(`  failed: ${f}`);
  process.exit(failed.length ? 1 : 0);
}, e => {
  console.error(e);
  process.exit(1);
});
