---
"playground-cli": patch
---

Nightly E2E now exercises the `--no-contract-build` error path: a new `nightly-rejections` cell asserts the integration-level error message when a Foundry project requests skip-build but ships no pre-built artefacts under `out/`.
