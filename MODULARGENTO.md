# Modulargento composer repository

Builds a Composer package repository from the cresset-tools forks and publishes
it to <https://modulargento.cresset.tools/>.

## What gets built

`src/make/modulargento.js` runs a **nightly-style** build (branch HEAD, versions
date-stamped off the latest tag) over the repos declared in
`src/build-config/modulargento-build-config.js`:

| Repo | Ref | Notes |
| --- | --- | --- |
| `cresset-tools/modulargento-magento2` | `main` | The monorepo fork, split into ~243 packages (`magento/*`) + the `project`/`product-community-edition` metapackages. |
| `cresset-tools/module-page-builder-widget` | `master` | Standalone module fork (base def from `packages-config.js`). |
| `cresset-tools/module-admin-activity-log` | `main` | Standalone module fork (def inline in the build config). |
| `cresset-tools/module-inventory-product-alert` | `main` | cresset-original module; no git tags — version comes from its `composer.json` (`3.0.0`). |

Everything else (security-package, inventory, the Zend forks, etc.) is unchanged
from upstream and is expected to be layered from `mirror.mage-os.org` in a
consuming project's `repositories`.

satis itself needs no per-repo config: `satis.json` is `type: artifact` +
`require-all`, so it picks up every zip under `build/packages/`.

## Prerequisites

- **node** + **composer** + **jq** on PATH.
- **`bin/php-classes.phar`** (committed) — the PHP source-dependency analyzer used
  to compute the base package's `require`. Put `bin/` on PATH so it resolves:
  `export PATH="$PWD/bin:$PATH"`.
- **`unzip`** CLI (composer extracts the base package's deps with it).
- A PHP with **ext-zip** for satis. This repo carries a `bougie` project
  (`bougie.toml` + `composer.json` requiring `ext-zip`); `bougie sync` once, then
  run the zip-dependent steps through `bougie run` so they use the zip-enabled PHP.
  (`composer install --ignore-platform-reqs` for the base-package analysis is
  already baked into `src/determine-dependencies.js`, since that PHP may lack a
  few ext-* the analysis doesn't actually need.)

## Build + satis

```sh
export PATH="$PWD/bin:$PATH"
bougie sync                      # materialise the zip-enabled PHP env

# 1. Build the packages (clones into generate-repo/repositories, zips into build/packages)
node src/make/modulargento.js \
  --outputDir=build/packages \
  --gitRepoDir=generate-repo/repositories \
  --repoUrl="https://modulargento.cresset.tools/"

# 2. satis config: homepage/repoUrl + local output paths
node bin/set-satis-homepage-url.js --satisConfig=satis.json \
  --repoUrl="https://modulargento.cresset.tools/" > /tmp/satis.json
cat <<< "$(jq '."output-dir"="../build" | .repositories[0].url="../build/packages"' /tmp/satis.json)" > /tmp/satis.json
cp mageos.html.twig satis/views/mageos.html.twig
jq -r .version package.json > satis/views/version

# 3. Run satis (needs ext-zip -> bougie run), then rewrite dist URLs to the host
cd satis && bougie run -- bin/satis build /tmp/satis.json ../build && cd ..
cd satis && bougie run -- node ../bin/set-satis-output-url-prefix.js \
  --satisOutputDir=../build --repoUrl="https://modulargento.cresset.tools/" && cd ..
```

satis is installed locally (not committed — see `.gitignore`) with composer:

```sh
bougie run -- composer create-project --no-interaction composer/satis:dev-main satis
```

> satis can't be installed via `bougie tool` yet: it's `type: composer-plugin`,
> which bougie's installer skips on extract.

## Publish

The deployable tree is `build/` (`packages.json`, `p2/`, `include/`,
`index.html`, `packages/`). nginx serves it at the host root; zip URLs resolve
under `/packages/` (immutable cache). The vhost lives in the `infra` repo
(`hosts/origin/nginx.nix`, docroot `/srv/modulargento`).

```sh
rsync -avz --delete build/ deploy@<origin>:/srv/modulargento/
```
