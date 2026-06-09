---
"playground-cli": minor
---

Add `playground deploy-all` for deploying multiple `.dot` apps in one invocation.

Apps are listed in a JSON manifest and built in parallel (`--concurrency N`), while all
on-chain work (Bulletin upload, DotNS, and the playground publish) is serialized per signer
account via a shared signing gate so concurrent same-account deploys never collide on a nonce.
Output is non-interactive and line-oriented with an optional `--json` per-app status summary.
The single-app `playground deploy` command is unchanged.
