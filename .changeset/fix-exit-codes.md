---
"playground-cli": patch
---

Fix `dot deploy` and `dot mod` exiting 0 on failures. Previously the CLI's entry point unconditionally called `process.exit(0)` after the action returned, overwriting the non-zero `process.exitCode` set by `scheduleHardExit()` (deploy preflight, e.g. `SignerNotAvailableError` from a corrupt session) and never set by `dot mod` at all on `runSetup` failures (e.g. registry miss). Both paths now propagate a non-zero exit code so shell scripts and CI pipelines can rely on the result.
