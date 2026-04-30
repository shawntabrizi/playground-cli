---
"playground-cli": patch
---

Fix `dot deploy` exiting 1 after a successful deploy. polkadot-api's `client.destroy()` can fire a `DisjointError: ChainHead disjointed` from a still-in-flight chainHead operation after the WS has closed, which surfaces as an unhandled rejection and forced the process to exit 1 even though the deploy completed and printed "Deploy complete". Now suppressed alongside the existing benign-teardown filter for `UnsubscriptionError: Not connected`.
