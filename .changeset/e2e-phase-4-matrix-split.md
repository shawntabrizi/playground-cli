---
"playground-cli": patch
---

E2E suite now runs as a 7-cell matrix on CI: 4 no-publish cells in parallel + 3 publish cells serial (sharing the registry signer to avoid nonce races). Adds full-deploy tests for the Foundry and CDM backends. Per-cell pass/fail is visible in the sticky PR comment with cell-specific JUnit + forensic logs.
