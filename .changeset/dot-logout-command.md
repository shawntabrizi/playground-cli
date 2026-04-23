---
"playground-cli": minor
---

Add `dot logout` to sign out of the account paired via `dot init` — no more `rm -rf ~/.polkadot-apps`. Notifies the mobile app so the paired-connection entry is removed there too, with a best-effort local-only cleanup fallback when the network is unreachable.
