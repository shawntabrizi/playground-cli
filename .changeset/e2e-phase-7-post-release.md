---
"playground-cli": patch
---

CI now validates the consumer install path after every stable release: `e2e-post-release.yml` fires on `release: published`, runs `install.sh`, and runs the same smoke tests as `e2e-release.yml` (Phase 7) but against the installed binary at `~/.polkadot/bin/dot`. Catches `install.sh` regressions that the prerelease/SEA-download path doesn't.
