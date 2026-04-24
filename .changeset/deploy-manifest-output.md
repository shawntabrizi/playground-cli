---
"playground-cli": minor
---

Add `dot deploy --manifest <path>` to write a machine-readable JSON manifest on successful deploy (versioned; contains domain, app URL, CIDs, and deployed contract addresses). Also fixes a display gap: deployed contract addresses are now shown in the final summary of both the TUI and the headless (`--signer … --domain … --buildDir … --playground`) output — previously they were computed and discarded.
