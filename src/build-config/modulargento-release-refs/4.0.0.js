// Source refs for building modulargento 4.0.0.
//
// `magento2` is the cresset-tools/modulargento-magento2 monorepo tip after
// merging Mage-OS upstream 4.0.0 into modulargento main. As with every release
// here, what was merged is upstream/main rather than the 4.0.0 tag: the tag is
// upstream/main plus one "Release 4.0.0" commit that renames magento/* to
// mage-os/* and pins every version, which is the job this generator does.
module.exports = {
  magento2: '579750628a61990e85192afcc178c582d3f3915b',
  // Feature repos pinned to the commits 4.0.0 is first built from, so a later
  // rebuild (as a previous release) does not pick up their newer main.
  inventory: '5e1e16001844b80990adc8c4df8890c2ea56b6ef',
  'inventory-composer-installer': 'f30e1b106815e1732d3f51646a12c77d64f4f95f',
  'page-builder': 'fc3f60d9daada6b71d8026076557efcabfab839a',
};
