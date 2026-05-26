---
"playground-cli": patch
---

`dot init` now shows the user's registry username (the handle set on the
playground.dot profile) when one has been claimed, falling back to the
People-parachain identity name and then to the H160, same precedence as
the playground-app. Also surfaces an "account in use" row with the
derivation path + H160 so the user can verify the exact account that
signs on their behalf.

`dot deploy --playground` now matches the v8 registry contract's 7-arg
`publish()` signature (adds `modded_from`, `is_moddable`, `is_dev_signer`),
which unblocks publishes against the freshly deployed v8 on Paseo Asset
Hub Next. `cdm.json` is refreshed to the v8 ABI; the runtime keeps
resolving the live contract address from the on-chain meta-registry.
