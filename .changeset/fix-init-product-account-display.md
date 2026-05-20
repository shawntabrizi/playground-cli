---
"playground-cli": patch
---

Request Bulletin allowance through the mobile resource-allocation flow again, normalize returned slot-account keys before caching/signing, keep the Bulletin faucet as a fallback when the returned account is not usable on-chain, and let `dot logout` recover from stale sessions missing the product-derivation root key.
