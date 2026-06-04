---
"playground-cli": patch
---

Dev-signer deploys no longer ask for phone approvals. bulletin-deploy 0.8.x resolves the persisted `playground init` login session whenever it is called without explicit auth options, which silently routed dev-mode DotNS signing through the phone and signed storage chunks with the user's phone-granted Bulletin quota. `--signer dev` now pins bulletin-deploy to its dev mnemonic and dev storage key explicitly, restoring zero-tap dev deploys. `--suri` deploys likewise pin chunk-upload signing to the suri key instead of silently using the cached slot key. Apps still appear in the owner's MyApps view when a session exists, and dev deploys still earn no XP.
