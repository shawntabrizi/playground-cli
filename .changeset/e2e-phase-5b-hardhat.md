---
"playground-cli": patch
---

Nightly E2E now exercises the Hardhat (EVM) full-deploy path: a new `nightly-deploy-hardhat` cell publishes the hardhat fixture's pre-built `Lock.sol` bytecode to the `e2e-cli-hardhat.dot` domain on Paseo. Runs on schedule/dispatch only (max-parallel: 1 with `pr-deploy-frontend`/`pr-deploy-foundry` since they share SIGNER), so per-PR runtime is unaffected.
