---
"playground-cli": minor
---

`dot init` now shows your username and your product account address alongside the existing "logged in" confirmation.

- **Username** comes from your on-chain identity on People parachain (`Resources.Consumers` storage). If you haven't registered a username yet you'll see `(no username set on chain)`; if the lookup fails or times out (5s) it falls back to `(lookup failed)`.
- **Product account** is the SS58 + truncated H160 derived locally from your root account via the same sr25519 soft-derivation path that the mobile wallet uses privately. The address you see here is the SAME one `playground-app` resolves for "My apps" and the SAME one your CLI signs as on-chain — so a quick eyeball is enough to confirm both clients agree on your identity.
