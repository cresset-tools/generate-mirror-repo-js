# Notes

## dependencies-template.json

Bundled dependencies for the `modulargento/product-minimal-edition` build.
Templates are resolved as `composer-templates/<vendor>/<metapackage name>`, so
this directory (not `mage-os/product-minimal`) is what the modulargento release
build reads.

Derived from `modulargento/product-community-edition`, restricted to the
entries the minimal preserve-filter (`transformMageOSMinimalProduct`) keeps:

- `aligent/magento2-pci-4-compatibility` and `creatuity/magento2-interceptors`
  are preserved by their literal names.
- `mage-os/theme-adminhtml-m137` is a standalone fork that keeps its mage-os
  vendor in the modulargento distribution; the preserve set carries the literal
  name for it.
- `mage-os/security-package` is intentionally absent: the modulargento release
  does not build the security-package feature repo (see the supportRepos note
  in `modulargento-release-build-config.js`).
- The modulargento feature metapackages (inventory, page-builder) and the other
  standalone feature forks are above-minimal and belong to the community
  edition template only.
