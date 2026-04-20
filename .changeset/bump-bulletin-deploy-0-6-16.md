---
"playground-cli": patch
---

Bump `bulletin-deploy` pin from 0.6.9 → 0.6.16.

Picks up a fix for `merkleizeJS` (CIDs now preserve their codec so DAG-PB blocks are correctly indexed in the CAR body — the upstream bug our `jsMerkle` workaround was avoiding), on-chain verification after every DotNS `setContenthash`, clearer preflight messages on sanitized-to-Reserved labels, chain-time commit-age waits, and an idempotent pool `topUpBy`. No API changes required on our side.
