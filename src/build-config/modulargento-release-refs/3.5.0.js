// Source refs for building modulargento 3.5.0.
//
// `magento2` is the cresset-tools/modulargento-magento2 monorepo tip after
// merging Mage-OS upstream 3.5.0 into modulargento main. As with every release
// here, what was merged is upstream/main rather than the 3.5.0 tag: the tag is
// upstream/main plus one "Release 3.5.0" commit that renames magento/* to
// mage-os/* and pins every version, which is the job this generator does.
module.exports = {
  magento2: '245691f6ec8ab719119b780c3b45887c2d7da26f',
  // Feature repos as they were when this release was last published (the
  // 2026-09-13 run). They build from their main branch otherwise, which has
  // moved since, and would change packages already published at this version.
  inventory: '5f4a61a25aab0f419cc73a7e5172f95adbb7b287',
  'inventory-composer-installer': 'f30e1b106815e1732d3f51646a12c77d64f4f95f',
  'page-builder': 'fc3f60d9daada6b71d8026076557efcabfab839a',
};
