---
"playground-cli": minor
---

`dot mod` now keeps the tail of `setup.sh` visible after the step completes — the script's "next steps" / quest progression / doc pointers no longer disappear when the step turns green. The full unfiltered output is also tee'd to `<targetDir>/.dot-mod-setup.log` for any output that doesn't fit the on-screen tail. The generic "edit with claude / dot deploy" footer now only prints when the app didn't ship a `setup.sh`.
