---
"playground-cli": patch
---

`dot init` now falls back to a dedicated testnet funder account if Alice is drained on Paseo Asset Hub — so new users aren't blocked the moment someone drains Alice. If both funders are low, the UI points users at `https://faucet.polkadot.io/` prefilled with their own address so they can self-fund and move on. `dot deploy --signer dev` gets the same fallback and, on exhaustion, guides the user to switch to the mobile signer instead. Adds a scheduled GitHub Actions workflow that files an issue when the dedicated funder needs topping up.
