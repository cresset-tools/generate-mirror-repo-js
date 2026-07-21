// Source refs for building modulargento 3.1.0, pinned so the release stays
// reproducible after the monorepo `main` advances to a newer release.
//
// `magento2` is the cresset-tools/modulargento-magento2 monorepo tip on the
// 3.1.0 line: `main` as it was immediately before the "Merge Mage-OS upstream
// (3.2.0) into modulargento main" merge (25cec440) — i.e. that merge's first
// parent. Without this pin the build would follow `main` and produce 3.2.0 code
// mislabelled as 3.1.0.
//
// Only the monorepo is pinned per-release; the mage-os infra/support forks are
// lockstep-renamed to the release version from their own branches (see
// modulargento-release-build-config.js).
module.exports = {
  magento2: '729bda123606721277c553c47059fff54bce725c',
};
