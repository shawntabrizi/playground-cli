---
"playground-cli": patch
---

Bump `bulletin-deploy` pin from `0.6.16` to `0.7.0`. The only breaking change in 0.7.0 is the removal of the `--playground` CLI flag and the `playground?: boolean` `DeployOption`; playground-cli already owns registry publishing via its own `publishToPlayground()` flow, so this is a no-op for the deploy path.
