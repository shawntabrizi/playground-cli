---
"playground-cli": patch
---

Bump `bulletin-deploy` from `0.7.24` to `0.7.29`. The API surface the CLI
consumes (`deploy()`, `DeployContent`/`DeployOptions`/`DeployResult`,
`DEFAULT_MNEMONIC`, and the `DotNS` methods `connect`/`checkOwnership`/
`getUserPopStatus`/`isTestnet`/`disconnect`) is unchanged across the bump;
all upstream changes are additive (new manifest-publish exports, new optional
fields). No CLI code changes were required.
