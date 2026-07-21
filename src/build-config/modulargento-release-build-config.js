const {
  transformMagentoCommunityEditionProject,
  transformMagentoCommunityEditionProduct
} = require('../build-metapackage/magento-community-edition');
const {
  transformMageOSCommunityEditionProject,
  transformMageOSCommunityEditionProduct
} = require('../build-metapackage/mage-os-community-edition');
const {
  transformModulargentoMinimalProduct,
  transformSetDescriptionFromBuildConfig
} = require('../build-metapackage/mage-os-minimal');

const packagesConfig = require('./packages-config');
const {mergeBuildConfigs} = require('../utils');

const modulargentoBaseTemplate =
  `${__dirname}/../../resource/composer-templates/modulargento/magento2-base/template.json`;

// ── Monorepo (cresset-tools/modulargento-magento2) ──────────────────────────
// Customize the shared magento2 packageDef:
//  - base package uses the modulargento base template
//  - split the extra framework sub-packages that modulargento's modularization
//    introduced (GraphQl, GraphQlSchemaStitching) — they have their own
//    composer.json (magento/framework-graph-ql[-schema-stitching]) but the
//    shared config only splits Amqp/Bulk/MessageQueue/Stomp, so without this
//    they'd be bundled into modulargento/framework yet required separately.
// Spread-copy only the entries we change (the base package's `excludes`
// contains functions, so structuredClone is not an option).
const monorepoSource = packagesConfig['magento2'];
const monorepoPackageIndividual = monorepoSource.packageIndividual
  .map(pkg => {
    if (pkg.dir === 'lib/internal/Magento/Framework') {
      return {
        ...pkg,
        excludes: [
          ...pkg.excludes,
          'lib/internal/Magento/Framework/GraphQl/',
          'lib/internal/Magento/Framework/GraphQlSchemaStitching/',
        ],
      };
    }
    if (pkg.label === 'Magento Base Package') {
      return {...pkg, composerJsonPath: modulargentoBaseTemplate};
    }
    return pkg;
  })
  .concat([
    {label: 'Magento Framework_GraphQl', dir: 'lib/internal/Magento/Framework/GraphQl'},
    {label: 'Magento Framework_GraphQlSchemaStitching', dir: 'lib/internal/Magento/Framework/GraphQlSchemaStitching'},
  ]);

// ── Library / infra support repos ───────────────────────────────────────────
// The monorepo packages require external infra (magento/composer,
// magento/magento-composer-installer, the zend/zf forks, …) that lives in
// separate Mage-OS repos. Like the Mage-OS release, we build them too (renamed
// to the release vendor + lockstep-versioned) so the repository is
// self-contained. The remaining feature repos (security-package, adobe-stock,
// sample-data) are still excluded — the monorepo does not depend on them.
const supportRepos = {
  'magento-composer-installer': {repoUrl: 'https://github.com/mage-os/mageos-magento-composer-installer.git', ref: 'main'},
  'composer': {repoUrl: 'https://github.com/mage-os/mageos-composer.git', ref: 'main'},
  'composer-dependency-version-audit-plugin': {repoUrl: 'https://github.com/mage-os/mageos-composer-dependency-version-audit-plugin.git', ref: 'mage-os'},
  'magento-zend-db': {repoUrl: 'https://github.com/mage-os/mageos-magento-zend-db.git', ref: 'mage-os'},
  'magento-zend-loader': {repoUrl: 'https://github.com/mage-os/mageos-magento-zend-loader.git', ref: 'mage-os'},
  'magento-zend-pdf': {repoUrl: 'https://github.com/mage-os/mageos-magento-zend-pdf.git', ref: 'mage-os'},
  'magento-zend-cache': {repoUrl: 'https://github.com/mage-os/mageos-magento-zend-cache.git', ref: 'mage-os'},
  'magento-zend-exception': {repoUrl: 'https://github.com/mage-os/mageos-magento-zend-exception.git', ref: 'mage-os'},
  'magento-zend-log': {repoUrl: 'https://github.com/mage-os/mageos-magento-zend-log.git', ref: 'mage-os'},
  'magento-zend-memory': {repoUrl: 'https://github.com/mage-os/mageos-magento-zend-memory.git', ref: 'mage-os'},
  'magento-zf-captcha': {repoUrl: 'https://github.com/mage-os/mageos-magento-zf-captcha.git', ref: 'main'},
  'magento-zf-db': {repoUrl: 'https://github.com/mage-os/mageos-magento-zf-db.git', ref: 'main'},
  'magento-zf-soap': {repoUrl: 'https://github.com/mage-os/mageos-magento-zf-soap.git', ref: 'main'},
  'php-compatibility-fork': {repoUrl: 'https://github.com/mage-os/mageos-PHPCompatibilityFork.git', ref: 'main'},
  'magento-coding-standard': {repoUrl: 'https://github.com/mage-os/mageos-magento-coding-standard.git', ref: 'main'},
  'magento2-functional-testing-framework': {repoUrl: 'https://github.com/mage-os/mageos-magento2-functional-testing-framework.git', ref: 'main'},
  'magento-allure-phpunit': {repoUrl: 'https://github.com/mage-os/mageos-magento-allure-phpunit.git', ref: 'main'},
};

// ── Feature repos folded into the lockstep release ──────────────────────────
// Unlike the support repos above, these ship actual storefront features. We
// build them (renamed to modulargento/ + lockstep-versioned) so the published
// distribution matches a full Mage-OS 3.0.0 and the mageos-maker module-removal
// matrix has every set present to strip:
//  - inventory (MSI) + its composer-installer plugin
//  - page-builder (required by the page-builder-widget fork below)
// The two decoupled MSI modules (InventoryGraphQl, InventoryProductAlert) are
// EXCLUDED from the stock inventory build and instead supplied by the cresset
// forks (see msiForks) so "remove a core set, keep MSI" still compiles.
const featureRepos = {
  'inventory': {repoUrl: 'https://github.com/mage-os/mageos-inventory.git', ref: 'main'},
  'inventory-composer-installer': {repoUrl: 'https://github.com/mage-os/mageos-inventory-composer-installer.git', ref: 'main'},
  'page-builder': {repoUrl: 'https://github.com/mage-os/mageos-magento2-page-builder.git', ref: 'main'},
};

// Drop the two modules we substitute with decoupled forks from the inventory
// package build (so their package names are produced only once, by the forks).
const inventoryPackagesConfig = {
  ...packagesConfig['inventory'],
  packageDirs: packagesConfig['inventory'].packageDirs.map(pkg => ({
    ...pkg,
    excludes: [...pkg.excludes, 'InventoryGraphQl/', 'InventoryProductAlert/', 'InventoryLowQuantityNotificationAdminUi/'],
  })),
};

// ── Decoupled MSI module forks (built into the lockstep release) ─────────────
// These cresset forks are authored under mage-os/* with mage-os/* deps. The
// normalizeVendorFromMageOs flag folds them back to magento/ first, so they
// flow through the standard magento->modulargento rename + replace map and end
// up as modulargento/module-inventory-{graph-ql,product-alert} at the release
// version — replacing the stock copies excluded above and satisfying the
// inventory metapackage's requirements.
const msiForks = {
  'module-inventory-graph-ql': {
    repoUrl: 'https://github.com/cresset-tools/module-inventory-graph-ql.git',
    ref: 'main',
    normalizeVendorFromMageOs: true,
    packageIndividual: [
      {label: 'Mage-OS Inventory GraphQl Module', dir: '', excludes: []}
    ],
  },
  'module-inventory-product-alert': {
    repoUrl: 'https://github.com/cresset-tools/module-inventory-product-alert.git',
    ref: 'main',
    normalizeVendorFromMageOs: true,
    packageIndividual: [
      {label: 'Mage-OS Inventory Product Alert Module', dir: '', excludes: []}
    ],
  },
  // Low-stock report admin UI, decoupled from Magento_Reports (its export
  // controllers extended a Reports controller base). Folded into the lockstep
  // release so it replaces the stock copy excluded above and keeps the
  // inventory metapackage satisfiable when the reports set is removed.
  'module-inventory-low-quantity-notification-admin-ui': {
    repoUrl: 'https://github.com/cresset-tools/module-inventory-low-quantity-notification-admin-ui.git',
    ref: 'main',
    normalizeVendorFromMageOs: true,
    packageIndividual: [
      {label: 'Mage-OS Inventory Low Quantity Notification Admin UI Module', dir: '', excludes: []}
    ],
  },
};

const releaseBuildConfig = {
  'magento2': {
    repoUrl: 'https://github.com/cresset-tools/modulargento-magento2.git',
    ref: 'main',
    extraMetapackages: [
      {
        name: 'project-community-edition',
        type: 'project',
        description: 'Modulargento Community Edition Project',
        transform: [
          transformMagentoCommunityEditionProject,
          transformMageOSCommunityEditionProject,
        ]
      },
      {
        name: 'product-community-edition',
        type: 'metapackage',
        description: 'Modulargento Community Edition',
        transform: [
          transformMagentoCommunityEditionProduct,
          transformMageOSCommunityEditionProduct,
        ]
      },
      {
        name: 'project-minimal-edition',
        type: 'project',
        description: 'Modulargento Minimal Edition Project',
        transform: [
          transformMagentoCommunityEditionProject,
          transformMageOSCommunityEditionProject,
          transformSetDescriptionFromBuildConfig,
        ]
      },
      {
        // Leaner than the stock Mage-OS minimal edition: modulargento's decoupling
        // lets the minimal keep-set drop bundle/grouped/downloadable/swatches/
        // wishlist/review/newsletter/reports/… (see transformModulargentoMinimalProduct).
        name: 'product-minimal-edition',
        type: 'metapackage',
        description: 'Modulargento Minimal Edition',
        transform: [
          transformMagentoCommunityEditionProduct,
          transformMageOSCommunityEditionProduct,
          transformModulargentoMinimalProduct,
          transformSetDescriptionFromBuildConfig,
        ]
      }
    ]
  },
  ...supportRepos,
  ...featureRepos,
  ...msiForks,
};

// Base structure (packageDirs/packageIndividual/excludes) for every built repo,
// taken from the shared packages-config (with the monorepo customizations).
const filteredPackagesConfig = {
  'magento2': {...monorepoSource, packageIndividual: monorepoPackageIndividual},
};
for (const key of Object.keys(supportRepos)) {
  filteredPackagesConfig[key] = packagesConfig[key];
}
filteredPackagesConfig['inventory'] = inventoryPackagesConfig;
filteredPackagesConfig['inventory-composer-installer'] = packagesConfig['inventory-composer-installer'];
filteredPackagesConfig['page-builder'] = packagesConfig['page-builder'];

// ── Standalone module forks (cresset-tools) ─────────────────────────────────
// NOT part of the lockstep release — each is published at its own version
// (latest tag, or composer.json version for the untagged one), keeping its own
// package name. Their magento/* deps resolve against the distribution via the
// modulargento packages' replace map, so no vendor rename is needed.
// src/make/modulargento-release.js builds these via createPackageForRef after
// the lockstep release. (The two MSI forks are NOT here — they're folded into
// the lockstep release via msiForks so they can be renamed to modulargento/*.)
const moduleBuildConfig = [
  {
    key: 'module-page-builder-widget',
    repoUrl: 'https://github.com/cresset-tools/module-page-builder-widget.git',
    ref: 'master',
    packageIndividual: [
      {label: 'Mage-OS Page Builder Widget Module', dir: '', excludes: []}
    ],
  },
  {
    key: 'module-admin-activity-log',
    repoUrl: 'https://github.com/cresset-tools/module-admin-activity-log.git',
    ref: 'main',
    packageIndividual: [
      {label: 'Mage-OS Admin Activity Log Module', dir: '', excludes: []}
    ],
  },
];

// Prior releases to rebuild into the SAME output on every run, so
// modulargento.cresset.tools serves every release at once (satis is an artifact
// repo with require-all:true, so it aggregates all versions present in
// build/packages). Each entry needs a matching
// src/build-config/modulargento-release-refs/<version>.js pinning its monorepo
// ref. Ordered oldest-first; the run's --mageosRelease is built last.
// Suppress with --skipHistory (e.g. a fast single-version dev build).
const previousReleases = [
  {version: '3.1.0', upstreamRelease: '2.4.8'},
];

module.exports = {
  buildConfig: mergeBuildConfigs(filteredPackagesConfig, releaseBuildConfig),
  moduleBuildConfig,
  previousReleases,
};
