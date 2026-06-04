---
"playground-cli": patch
---

Fix phone-mode `playground deploy` and `playground decentralise` failing with "Mobile transaction signing rejected: message too big" during the Bulletin upload. Bulletin storage chunks (up to 2 MiB each) are now signed with the local Bulletin allowance slot key instead of being routed to the phone, whose signing channel caps messages far below chunk size. The phone is still used for DotNS and registry publish approvals. Also bumps bulletin-deploy to 0.8.3, the first release with `storageSigner` support. If the slot key is missing, deploy now fails fast with a hint to re-run `playground init` instead of retrying chunks against an impossible signer.

Also handles expired phone sessions cleanly. The statement-store allowance that carries every phone interaction lapses ~2 days after login and cannot be renewed remotely; previously an expired session made phone signing hang for minutes and fail with a cryptic "transaction watcher silent" error. Phone signing now fails within a second with a clear "run `playground logout` then `playground init`" message, and `playground deploy` warns up front when the last login is more than 2 days old.

Fixes the Bulletin slot account derivation: the SDK derives the wrong public key from phone-issued 64-byte slot keys (missing schnorrkel scalar normalization), so storage and metadata uploads signed as an address the chain never authorized. This silently dropped phone-mode deploys onto the shared pool account, where transactions race other users' nonces and die with `AncientBirthBlock`. Uploads now sign as the address the phone actually granted the allowance to.

Phone-mode deploys also check the slot's remaining quota against the estimated upload size before starting. An undersized allowance triggers a single Increase approval on the phone up front; if the quota still looks short after that, the deploy warns and proceeds rather than blocking, since the authorization itself is what the chain checks.

Fixes session selection after repeated pairings: the CLI used to operate on the OLDEST persisted session, so after a re-pair, requests (including the `playground init` allowance approval) could be sent into a session the phone no longer serves, disappearing without an error. All flows now use the most recent pairing, and a successful login disconnects leftover stale sessions.
