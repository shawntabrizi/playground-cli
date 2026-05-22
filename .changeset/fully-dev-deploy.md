---
"playground-cli": minor
---

`dot deploy --signer dev --playground` now requires zero phone taps when an active phone session exists. The CLI signs every on-chain step with a synthesised Alice signer (matching bulletin-deploy's default identity) but passes the user's session H160 as the registry contract's new `owner` argument, so the published app still appears in the user's MyApps view in playground-app. Phone mode is unchanged; dev mode with `--suri` is unchanged. Requires the redeployed playground registry contract (new `publish(domain, metadata_uri, visibility, owner: Option<Address>)` signature) on Paseo Next v2.
