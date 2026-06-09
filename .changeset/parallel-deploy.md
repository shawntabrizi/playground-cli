---
"playground-cli": minor
---

Add `playground deploy-all` for deploying multiple `.dot` apps in one invocation.

Apps are listed in a JSON manifest and built/uploaded in parallel (`--concurrency N`),
while on-chain signing is serialized per signer account via a shared signing gate so
concurrent same-account deploys never collide on a nonce. Output is non-interactive and
line-oriented with an optional `--json` per-app status summary. The single-app
`playground deploy` command is unchanged.
