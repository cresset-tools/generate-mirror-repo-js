const {
  transformMagentoCommunityEditionProject,
  transformMagentoCommunityEditionProduct
} = require('../build-metapackage/magento-community-edition');
const {
  transformMageOSCommunityEditionProject,
  transformMageOSCommunityEditionProduct
} = require('../build-metapackage/mage-os-community-edition');

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
// self-contained. Feature repos (security-package, inventory, page-builder,
// adobe-stock, sample-data) are intentionally excluded — the monorepo does not
// depend on them.
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
      }
    ]
  },
  ...supportRepos,
};

// Base structure (packageDirs/packageIndividual/excludes) for every built repo,
// taken from the shared packages-config (with the monorepo customizations).
const filteredPackagesConfig = {
  'magento2': {...monorepoSource, packageIndividual: monorepoPackageIndividual},
};
for (const key of Object.keys(supportRepos)) {
  filteredPackagesConfig[key] = packagesConfig[key];
}

// ── Standalone module forks (cresset-tools) ─────────────────────────────────
// NOT part of the lockstep release — each is published at its own version
// (latest tag, or composer.json version for the untagged one), keeping its own
// package name. src/make/modulargento-release.js builds these via
// createPackageForRef after the lockstep release.
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
  {
    key: 'module-inventory-product-alert',
    repoUrl: 'https://github.com/cresset-tools/module-inventory-product-alert.git',
    ref: 'main',
    packageIndividual: [
      {label: 'Mage-OS Inventory Product Alert Module', dir: '', excludes: []}
    ],
  },
  {
    key: 'module-inventory-graph-ql',
    repoUrl: 'https://github.com/cresset-tools/module-inventory-graph-ql.git',
    ref: 'main',
    packageIndividual: [
      {label: 'Mage-OS Inventory GraphQl Module', dir: '', excludes: []}
    ],
  },
];

module.exports = {
  buildConfig: mergeBuildConfigs(filteredPackagesConfig, releaseBuildConfig),
  moduleBuildConfig,
};
