---
"playground-cli": patch
---

Fix `dot init` and `dot deploy --signer phone` to target the same product-derived account that actually signs on-chain.

`session.remoteAccount.accountId` carries the user's wallet account, not the per-app product account the mobile signs with. The CLI was funding / allowance-marking / displaying the wallet address while the chain saw a different `From`. The CLI now soft-derives the product-account public key locally from `session.rootAccountId` using the same `"/product/{productId}/{derivationIndex}"` path the mobile wallet derives privately, so all three flows (`dot init`, `dot deploy --signer phone`, and the deployed playground-app's `HostProvider.getProductAccount`) resolve to the SAME SS58 for a given user. `PLAYGROUND_PRODUCT_ID` is also aligned to `"playground.dot"` to match the deployed playground-app.

The deploy summary now shows the signing SS58 (e.g. `Signer  Your phone signer (5HRBs5…)`) so users can verify the account before approving. Bulletin-deploy's preflight log line that showed the dev-master fallback address (`SS58 Address: 5DfhG…`) during the availability check is silenced; only the real deploy's signing address surfaces.
