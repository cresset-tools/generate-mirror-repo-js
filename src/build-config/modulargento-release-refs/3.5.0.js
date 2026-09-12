// Source refs for building modulargento 3.5.0.
//
// `magento2` is the cresset-tools/modulargento-magento2 monorepo tip after
// merging Mage-OS upstream 3.5.0 into modulargento main. As with every release
// here, what was merged is upstream/main rather than the 3.5.0 tag: the tag is
// upstream/main plus one "Release 3.5.0" commit that renames magento/* to
// mage-os/* and pins every version, which is the job this generator does.
module.exports = {
  magento2: '245691f6ec8ab719119b780c3b45887c2d7da26f',
};
