---
"playground-cli": patch
---

Bump `bulletin-deploy` from `0.6.9-rc.6` to `0.6.9` (stable). Upstream changes:

- **fix(dotns)** — Lite signers are now correctly rejected on `NoStatus` labels, matching the on-chain `PopRules` contract (upstream #101). Previously the check was missing the requirement clause and could let a Lite user through the classifier, only to have the register tx revert later.
- **feat(dotns)** — bulletin-deploy now runs its own `DotNS.preflight(label)` before any Bulletin upload (upstream #102). Deploys that were going to fail DotNS registration (wrong label class, reserved base name, domain owned by someone else, unresolvable PoP gate) now abort with **zero Bulletin bytes paid**, saving users a failed multi-MB upload. A new public `DotNS.preflight()` view-only method and `simulateUserStatus()` / `popStatusName()` helpers are also exported.

Our code surface (the `deploy()` entrypoint + `DotNS.connect` / `classifyName` / `checkOwnership` / `disconnect`) is unchanged, so the bump is drop-in. 147/147 tests pass.
