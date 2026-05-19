---
"playground-cli": patch
---

Internal: bump `@parity/product-sdk-*` packages and `bulletin-deploy` to current latest, and consume `deriveProductAccountPublicKey` from `@parity/product-sdk-keys` instead of a local mirror. No user-visible behaviour change; output is byte-identical for production inputs.
