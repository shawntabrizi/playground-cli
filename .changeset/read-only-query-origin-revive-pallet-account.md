---
"playground-cli": patch
---

Read-only registry queries (`playground mod` browse/metadata, registry username lookups) now dry-run with pallet-revive's keyless pallet account as origin instead of Alice's dev account, matching `@parity/product-sdk-contracts`' query fallback origin.
