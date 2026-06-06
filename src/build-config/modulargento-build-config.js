const {
  transformMagentoCommunityEditionProject,
  transformMagentoCommunityEditionProduct
} = require('../build-metapackage/magento-community-edition');
const packagesConfig = require('./packages-config');
const {mergeBuildConfigs} = require('../utils');

const branchBuildConfig = {
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
        ]
      },
      {
        name: 'product-community-edition',
        type: 'metapackage',
        description: 'Modulargento Community Edition',
        transform: [
          transformMagentoCommunityEditionProduct,
        ]
      }
    ],
    transform: {},
  },
  // Standalone module forks maintained under cresset-tools. These live outside
  // the magento2 monorepo, so each is its own single-package repo built from
  // its default branch HEAD (nightly versioning off the latest tag).
  'module-page-builder-widget': {
    repoUrl: 'https://github.com/cresset-tools/module-page-builder-widget.git',
    ref: 'master',
  },
  'module-admin-activity-log': {
    repoUrl: 'https://github.com/cresset-tools/module-admin-activity-log.git',
    ref: 'main',
    packageDirs: [],
    packageIndividual: [
      {label: 'Mage-OS Admin Activity Log Module', dir: ''}
    ],
    packageMetaFromDirs: [],
  },
  'module-inventory-product-alert': {
    repoUrl: 'https://github.com/cresset-tools/module-inventory-product-alert.git',
    ref: 'main',
    packageDirs: [],
    packageIndividual: [
      {label: 'Mage-OS Inventory Product Alert Module', dir: ''}
    ],
    packageMetaFromDirs: [],
  },
};

// Build the magento2 monorepo fork plus the standalone module forks maintained
// under cresset-tools. Everything else (security-package, inventory, the Zend
// forks, etc.) is unchanged from upstream and can be layered from
// mirror.mage-os.org. module-page-builder-widget already has a base packageDef
// in packages-config (single-package); the other two are cresset-original and
// define their structure inline in branchBuildConfig above.
const filteredPackagesConfig = {
  'magento2': packagesConfig['magento2'],
  'module-page-builder-widget': packagesConfig['module-page-builder-widget'],
};

module.exports = {
  buildConfig: mergeBuildConfigs(filteredPackagesConfig, branchBuildConfig)
};
