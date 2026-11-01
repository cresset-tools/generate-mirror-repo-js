// Source refs for building modulargento 3.1.0, pinned so the release stays
// reproducible after the monorepo `main` advances to a newer release.
//
// `magento2` is the cresset-tools/modulargento-magento2 monorepo tip on the
// 3.1.0 line: `main` as it was immediately before the "Merge Mage-OS upstream
// (3.2.0) into modulargento main" merge (25cec440) — i.e. that merge's first
// parent. Without this pin the build would follow `main` and produce 3.2.0 code
// mislabelled as 3.1.0.
//
// The monorepo and the feature repos are pinned per-release; the mage-os
// infra/support forks are lockstep-renamed to the release version from their
// own branches (see modulargento-release-build-config.js).
module.exports = {
  magento2: '729bda123606721277c553c47059fff54bce725c',
  // Feature repos as they were when this release was last published (the
  // 2026-09-13 run). They build from their main branch otherwise, which has
  // moved since, and would change packages already published at this version.
  inventory: '5f4a61a25aab0f419cc73a7e5172f95adbb7b287',
  'inventory-composer-installer': 'f30e1b106815e1732d3f51646a12c77d64f4f95f',
  'page-builder': 'fc3f60d9daada6b71d8026076557efcabfab839a',
};
