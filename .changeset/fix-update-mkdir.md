---
"playground-cli": patch
---

`dot update` now creates its install directory if missing instead of failing with ENOENT. Previously the directory was assumed to exist (created by `install.sh` during `dot init`), causing `dot update` to fail on environments that didn't run the installer (e.g. CI runners spawning the CLI directly). Fixes #97.
