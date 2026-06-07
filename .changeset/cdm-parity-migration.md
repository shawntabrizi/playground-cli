---
"playground-cli": patch
---

Migrate contract tooling from the deprecated `@dotdm/*` packages to their `@parity/cdm-*` republished equivalents, adopting the flattened `CdmJson` shape (dependencies and contracts are now flat library-keyed maps with a single top-level registry). A project carrying a pre-migration multi-target `cdm.json` now gets a clear error asking it to regenerate, instead of failing opaquely. `playground init` now installs `cargo-pvm-contract` from a pinned upstream `main` commit instead of a feature branch.
