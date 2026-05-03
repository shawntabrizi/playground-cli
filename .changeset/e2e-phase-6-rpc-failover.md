---
"playground-cli": patch
---

Adds `DOT_BULLETIN_RPC` env-var override to `getChainConfig()`, allowing tests (or operators in an emergency) to prepend a custom Bulletin RPC endpoint while keeping the built-in URL as a fallback. The new `nightly-chaos-rpc` cell exercises this by setting an unroutable primary URL and asserting the deploy still completes via failover.
