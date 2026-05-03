---
"playground-cli": patch
---

CI now validates published RC binaries: a new `e2e-release.yml` workflow fires on `release: prereleased`, downloads the `dot-linux-x64` SEA asset, and runs `e2e/cli/published.test.ts` smoke tests (`--version`, `--help`). Catches packaging regressions before stable release.
