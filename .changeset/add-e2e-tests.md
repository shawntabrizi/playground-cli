---
"playground-cli": patch
---

Add E2E integration test suite covering install, build, init, session, deploy, mod, and diagnostic commands. Tests spawn the CLI as a child process via execa and assert on stdout/stderr/exit codes. Deploy tests verify contract detection for Foundry, Hardhat, and CDM backends. Includes CI workflow, fixture projects, and chain query helpers for Paseo testnet validation.
