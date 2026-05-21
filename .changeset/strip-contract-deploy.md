---
"playground-cli": patch
---

Move contract deployment out of `dot deploy` and add CDM-backed `dot contract deploy/install` commands. `dot contract deploy` now calls CDM's deploy pipeline with dot's signer and Bulletin allowance signer, renders a CDM-style Ink progress table using dot's shared TUI primitives, and `dot contract install` delegates to CDM's installer.
