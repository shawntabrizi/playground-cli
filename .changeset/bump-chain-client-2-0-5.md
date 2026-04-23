---
"playground-cli": patch
---

Bump `@polkadot-apps/chain-client` to 2.0.5, which rotates the Paseo Asset Hub preset RPC list to live endpoints. Fixes `dot init` hanging on the funding step with repeated "Unable to connect to …" errors when both previously-configured endpoints (Dwellir, `sys.ibp.network`) were simultaneously unhealthy.
