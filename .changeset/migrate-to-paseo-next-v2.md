---
"playground-cli": minor
---

Migrate to paseo-next-v2 (Asset Hub Next 1500, Bulletin Next 1501, People Next System 1502). `dot init` now requests RFC-0010 resource allowances (Bulletin + Statement Store + smart-contract gas) from the user's mobile wallet before mapping the account; PAS funding from a dedicated funder account is gone. Grants are cached at `~/.polkadot/allowances.json` (per env, per address, per resource) so repeat `dot init` runs don't re-prompt. `dot mod` no longer requires login or account-mapping to browse moddable apps.

Behind the scenes: bumped `bulletin-deploy` to 0.7.19 (ships the paseo-next-v2 env with `autoAccountMapping`/`bulletinAuthorizeV2`/`skipDotnsCli` flags), `@parity/product-sdk-*` to the 0.5.0 facade release (PAPI-native signer fixes `AsPgas` signed-extension support), `@dotdm/contracts` to ^2.0.3, `@novasamatech/*` overrides to 0.7.9-4.
