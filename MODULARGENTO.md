# Modulargento composer repository

Builds and publishes a **release** Composer repository for the modulargento
distribution to <https://modulargento.cresset.tools/>. Modulargento is a more
granularly-modularized fork of Mage-OS; a release is dependency-compatible with
the corresponding Magento Open Source version.

This is a release-only repository — there is no nightly build.

## What gets built

`src/make/modulargento-release.js` (config: `src/build-config/modulargento-release-build-config.js`)
produces, for a release `X.Y.Z`:

1. **The monorepo**, `cresset-tools/modulargento-magento2` (`main`), split into
   `modulargento/*` packages at `X.Y.Z`. The vendor is renamed `magento/*` →
   `modulargento/*` and lockstep-pinned to the release version. Includes the
   `project-`/`product-community-edition` metapackages and the
   `modulargento/magento2-base` package (from
   `resource/composer-templates/modulargento/magento2-base/template.json`).
   The modularization adds two extra framework sub-packages
   (`framework-graph-ql`, `framework-graph-ql-schema-stitching`) that are split
   out of `modulargento/framework`.
2. **Library/infra support packages** built from the upstream Mage-OS source
   repos (`mageos-composer`, `mageos-magento-zend-*`, …), also renamed to
   `modulargento/*` and lockstep-pinned — so the repository is self-contained.
   (Feature repos like security-package/inventory/page-builder are intentionally
   excluded; the monorepo doesn't depend on them.)
3. **Standalone module forks** (`cresset-tools/module-admin-activity-log`,
   `module-page-builder-widget`, `module-inventory-product-alert`) at **their
   own versions** (latest git tag, or `composer.json` version for the untagged
   one) — not lockstep-pinned, keeping their own package names.

Compatibility with the upstream Magento Open Source release is established via
the composer `replace` map: each `modulargento/*` package replaces the
corresponding `magento/*` at the `--upstreamRelease` version (fetched from the
public `mirror.mage-os.org`).

Unlike the Mage-OS release flow this does **not** create or push git tags on the
source repos — `cresset-tools/modulargento-magento2` already carries an
inherited tag, so packages are built from a committed prep work-branch instead.

## Release via CI (primary path)

Dispatch the **Build & deploy Modulargento release** workflow
(`.github/workflows/build-modulargento-release.yml`) with:

- `mageos_release` — e.g. `3.0.0`
- `upstream_release` — the Magento OSS version for compatibility, e.g. `2.4.8`
- `repo` — `https://modulargento.cresset.tools/`
- `remote_dir` — `/srv/modulargento/`
- `remote_host` — an SSH host that resolves to the origin (e.g. `modulargento.cresset.tools`)

It calls the shared `deploy.yml`, which builds, runs satis, rewrites dist URLs to
the repo URL, and rsyncs the result to `remote_host:remote_dir`. Requires the
repo secrets `SERVER_SSH_KEY` + `REMOTE_USER` (already configured) and the
matching public key authorized on the origin's `deploy` user.

## Local dry run

Prerequisites: `node`, `composer`, `jq`, `unzip`; `bin/` on `PATH` (provides the
committed `php-classes.phar` analyzer + a `php` shim); a PHP with `ext-zip` for
satis — this repo carries a bougie env (`bougie.toml` + `composer.json`), so
`bougie sync` once and run the zip-dependent steps through `bougie run`.

```sh
export PATH="$PWD/bin:$PATH"
bougie sync

node src/make/modulargento-release.js \
  --outputDir=build/packages --gitRepoDir=generate-repo/repositories \
  --repoUrl=https://modulargento.cresset.tools/ \
  --mageosVendor=modulargento --mageosRelease=3.0.0 --upstreamRelease=2.4.8

# satis (needs ext-zip -> bougie run)
node bin/set-satis-homepage-url.js --satisConfig=satis.json \
  --repoUrl=https://modulargento.cresset.tools/ > /tmp/satis.json
cat <<< "$(jq '."output-dir"="../build" | .repositories[0].url="../build/packages"' /tmp/satis.json)" > /tmp/satis.json
cp mageos.html.twig satis/views/mageos.html.twig
jq -r .version package.json > satis/views/version
cd satis && bougie run -- bin/satis build /tmp/satis.json ../build && cd ..
cd satis && bougie run -- node ../bin/set-satis-output-url-prefix.js \
  --satisOutputDir=../build --repoUrl=https://modulargento.cresset.tools/ && cd ..
```

satis is installed locally (not committed) with composer:
`bougie run -- composer create-project --no-interaction composer/satis:dev-main satis`.
(It can't be installed via `bougie tool` — satis is `type: composer-plugin`,
which bougie's installer skips on extract.)

## Publish target

The deployable tree is `build/` (`packages.json`, `p2/`, `include/`,
`index.html`, `packages/`), served by nginx at the host root with `/packages/`
under an immutable cache. The vhost lives in the `infra` repo
(`hosts/origin/nginx.nix`, docroot `/srv/modulargento`).
