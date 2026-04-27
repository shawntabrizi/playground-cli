---
"playground-cli": patch
---

`dot mod` no longer leaves an `upstream` remote behind after fork+clone, so `git checkout quest/level-N` (and the commands printed by tutorial `setup.sh` scripts) work without `--track origin/<name>` workarounds.
