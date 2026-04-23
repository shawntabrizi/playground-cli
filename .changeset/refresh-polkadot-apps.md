---
"playground-cli": patch
---

Refresh remaining `@polkadot-apps/*` direct dependencies to their current latest. PR #44 narrowly bumped `chain-client`; this widens to pick up the siblings that the monorepo had already co-released via its `workspace:*` + changesets patch cascade:

- `@polkadot-apps/bulletin` 0.6.9 → 0.6.10
- `@polkadot-apps/contracts` 0.3.2 → 0.4.0

Also eliminates the duplicate `chain-client@2.0.4` that was being pulled transitively by the old bulletin — single resolved version now (`2.0.5`).
