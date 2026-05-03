---
"playground-cli": patch
---

Nightly E2E now exercises the SIGINT cleanup path: a new `nightly-chaos-sigint` cell sends SIGINT to `dot deploy` mid-flight and asserts the process-guard's runAllCleanupAndExit handler exits cleanly within 5s with code 130 (or SIGINT signal).
