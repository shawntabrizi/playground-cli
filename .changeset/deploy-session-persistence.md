---
"playground-cli": patch
---

Fix `playground init` appearing to succeed while the mobile session vanished, so every subsequent `playground deploy` failed with "No signer available".

Root cause: the mobile SSO statement-store topic is derived from the phone's (reused) session account and the host's persisted device identity, so re-pairing the same phone reused the same topic. The phone posts a `Disconnected` statement on that topic when it supersedes a session, and statements live 7 days; on the next pairing the SDK replayed that stale `Disconnected` from the topic history and immediately tore the freshly paired session back out of the local repository (leaving the secret blobs behind). `playground init` now rotates the host device identity before a fresh QR pairing, so each pairing lands on a clean topic immune to stale disconnects — which also recovers an already-poisoned install without waiting out the 7-day TTL or a manual `playground logout`.

`playground deploy` also degrades gracefully when no session exists: the interactive signer picker shows a yellow "Mobile signing unavailable" notice and offers the dev signer instead of crashing, and an explicit headless `--signer phone` without a session fails with a clear instruction to run `playground init`.
