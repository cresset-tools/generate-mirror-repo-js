const {
  transformMageOSMinimalProduct,
  transformModulargentoMinimalProduct,
} = require('../../../src/build-metapackage/mage-os-minimal');

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
});
