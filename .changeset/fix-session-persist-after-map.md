---
"playground-cli": patch
---

Fixed an intermittent `Revive::AccountUnmapped` failure during contract deploys. The per-deploy session key is now persisted to `~/.config/dot/accounts.json` only AFTER its `map_account` extrinsic is confirmed on chain. Previously the persist happened first, so a failing `map_account` (e.g. nonce race, transient chain error) left the on-disk state lying — the retry would find the existing key, skip the mapping step, and fail at the dry-run with AccountUnmapped. Fixes #94.
