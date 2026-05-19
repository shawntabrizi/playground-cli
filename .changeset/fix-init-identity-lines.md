---
"playground-cli": patch
---

Fix `dot init` identity block: print the full product-account SS58 and 0x-prefixed H160 instead of truncated `5DHk4g...CzE1 (0x8849...29dc)`, and fix the username lookup so it actually queries `Resources.Consumers` correctly. The previous code routed the SS58 through `AccountId().dec(...)` (which is meant for `0x`-hex input, not SS58) and silently corrupted the storage key, so every lookup surfaced as `(lookup failed)`. Now the SS58 is passed straight to `getValues`, matching the polkadot-desktop / dotli / triangle-js-sdks pattern.
