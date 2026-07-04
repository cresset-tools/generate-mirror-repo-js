const {
  transformMageOSMinimalProduct,
  transformModulargentoMinimalProduct,
  transformSetDescriptionFromBuildConfig,
} = require('../../../src/build-metapackage/mage-os-minimal');

// Must stay in sync with removeExtra in transformModulargentoMinimalProduct.
const LEANER_REMOVALS = [
  'module-bundle',
  'module-quote-bundle-options',
  'module-grouped-product',
  'module-downloadable',
  'module-quote-downloadable-links',
  'module-swatches',
  'module-swatches-layered-navigation',
  'module-wishlist',
  'module-review',
  'module-newsletter',
  'module-gift-message',
  'module-reports',
  'module-product-alert',
  'module-order-cancellation',
  'module-order-cancellation-ui',
  'module-contact',
];

const inputs = (require, vendor = 'mage-os') => ({
  composerConfig: { version: '3.1.0', name: 'product-minimal', require },
  instruction: { vendor },
  metapackage: { name: 'product-minimal' },
  release: { version: '3.1.0' },
});

const communityLike = () => ({
  'php': '~8.3.0',
  'laminas/laminas-i18n': '^2.17',
  'laminas/laminas-view': '^2.20',
  'mage-os/module-catalog': '3.1.0',
  'mage-os/module-checkout': '3.1.0',
  'mage-os/module-bundle': '3.1.0',
  'mage-os/module-wishlist': '3.1.0',
  'mage-os/module-review': '3.1.0',
  'mage-os/module-paypal': '3.1.0', // above-minimal → dropped by both
});

describe('minimal edition — laminas-view fix', () => {
  // The published product-minimal-edition drops laminas-view while keeping
  // laminas-i18n, whose View helpers reference it → setup:di:compile fatals.
  test('standard minimal preserves laminas-view', async () => {
    const i = inputs(communityLike());
    await transformMageOSMinimalProduct(i.composerConfig, i.instruction, i.metapackage, i.release);
    expect(i.composerConfig.require['laminas/laminas-view']).toBe('^2.20');
    expect(i.composerConfig.require['laminas/laminas-i18n']).toBeDefined();
  });

  test('standard minimal keeps storefront features, drops above-minimal (paypal)', async () => {
    const i = inputs(communityLike());
    await transformMageOSMinimalProduct(i.composerConfig, i.instruction, i.metapackage, i.release);
    expect(i.composerConfig.require['mage-os/module-bundle']).toBeDefined();
    expect(i.composerConfig.require['mage-os/module-wishlist']).toBeDefined();
    expect(i.composerConfig.require['mage-os/module-paypal']).toBeUndefined();
  });
});

describe('leaner modulargento minimal edition', () => {
  test('drops bundle/wishlist/review too, keeps core + laminas-view', async () => {
    const i = inputs(communityLike());
    await transformModulargentoMinimalProduct(i.composerConfig, i.instruction, i.metapackage, i.release);
    expect(i.composerConfig.require['laminas/laminas-view']).toBe('^2.20'); // fix survives the chain
    expect(i.composerConfig.require['mage-os/module-catalog']).toBeDefined();
    expect(i.composerConfig.require['mage-os/module-checkout']).toBeDefined();
    expect(i.composerConfig.require['mage-os/module-bundle']).toBeUndefined();
    expect(i.composerConfig.require['mage-os/module-wishlist']).toBeUndefined();
    expect(i.composerConfig.require['mage-os/module-review']).toBeUndefined();
  });

  test('is a strict subset of the standard minimal', async () => {
    const std = inputs(communityLike());
    await transformMageOSMinimalProduct(std.composerConfig, std.instruction, std.metapackage, std.release);
    const lean = inputs(communityLike());
    await transformModulargentoMinimalProduct(lean.composerConfig, lean.instruction, lean.metapackage, lean.release);
    const stdKeys = Object.keys(std.composerConfig.require);
    const leanKeys = Object.keys(lean.composerConfig.require);
    expect(leanKeys.length).toBeLessThan(stdKeys.length);
    leanKeys.forEach((k) => expect(stdKeys).toContain(k));
  });

  test('respects the modulargento vendor prefix', async () => {
    const i = inputs({
      'modulargento/module-catalog': '3.1.0',
      'modulargento/module-bundle': '3.1.0',
      'laminas/laminas-view': '^2.20',
    }, 'modulargento');
    await transformModulargentoMinimalProduct(i.composerConfig, i.instruction, i.metapackage, i.release);
    expect(i.composerConfig.require['modulargento/module-catalog']).toBeDefined();
    expect(i.composerConfig.require['modulargento/module-bundle']).toBeUndefined();
  });

  test('leaves historical (non-release) versions untouched', async () => {
    const i = inputs(communityLike());
    i.composerConfig.version = '3.0.0'; // != release.version 3.1.0
    await transformModulargentoMinimalProduct(i.composerConfig, i.instruction, i.metapackage, i.release);
    // Unchanged: still has paypal + bundle (no filtering applied).
    expect(i.composerConfig.require['mage-os/module-paypal']).toBeDefined();
    expect(i.composerConfig.require['mage-os/module-bundle']).toBeDefined();
  });

  // A typo'd removeExtra suffix silently filters nothing, so drive every
  // intended removal end-to-end: feed all of them (kept by the base minimal
  // preserve set) and assert each one is gone from the leaner edition.
  test('drops every intended extra module', async () => {
    const require = { 'modulargento/module-catalog': '3.1.0' };
    LEANER_REMOVALS.forEach((suffix) => {
      require[`modulargento/${suffix}`] = '3.1.0';
    });
    const i = inputs(require, 'modulargento');
    await transformModulargentoMinimalProduct(i.composerConfig, i.instruction, i.metapackage, i.release);
    expect(i.composerConfig.require['modulargento/module-catalog']).toBeDefined();
    LEANER_REMOVALS.forEach((suffix) => {
      expect(i.composerConfig.require[`modulargento/${suffix}`]).toBeUndefined();
    });
  });

  // theme-adminhtml-m137 is a standalone fork that keeps its mage-os vendor in
  // the modulargento distribution, so the preserve set must keep the literal
  // name when the build vendor is modulargento.
  test('preserves the mage-os-vendored adminhtml theme under the modulargento vendor', async () => {
    const i = inputs({
      'modulargento/module-catalog': '3.1.0',
      'mage-os/theme-adminhtml-m137': '3.1.0',
      'mage-os/module-paypal': '3.1.0', // other mage-os names still filtered
    }, 'modulargento');
    await transformModulargentoMinimalProduct(i.composerConfig, i.instruction, i.metapackage, i.release);
    expect(i.composerConfig.require['mage-os/theme-adminhtml-m137']).toBe('3.1.0');
    expect(i.composerConfig.require['mage-os/module-paypal']).toBeUndefined();
  });
});

describe('metapackage description from build config', () => {
  // The community-edition transforms hard-code Community Edition descriptions;
  // this transform re-applies the build config's description afterwards.
  test('applies metapackage.description for the current release', async () => {
    const i = inputs(communityLike());
    i.composerConfig.description = 'eCommerce Platform for Growth (Community Edition)';
    i.metapackage.description = 'Modulargento Minimal Edition';
    await transformSetDescriptionFromBuildConfig(i.composerConfig, i.instruction, i.metapackage, i.release);
    expect(i.composerConfig.description).toBe('Modulargento Minimal Edition');
  });

  test('leaves historical versions and description-less entries untouched', async () => {
    const historical = inputs(communityLike());
    historical.composerConfig.version = '3.0.0';
    historical.composerConfig.description = 'original';
    historical.metapackage.description = 'Modulargento Minimal Edition';
    await transformSetDescriptionFromBuildConfig(historical.composerConfig, historical.instruction, historical.metapackage, historical.release);
    expect(historical.composerConfig.description).toBe('original');

    const noDescription = inputs(communityLike());
    noDescription.composerConfig.description = 'original';
    await transformSetDescriptionFromBuildConfig(noDescription.composerConfig, noDescription.instruction, noDescription.metapackage, noDescription.release);
    expect(noDescription.composerConfig.description).toBe('original');
  });
});
