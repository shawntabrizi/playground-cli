---
"playground-cli": minor
---

Rename the CLI command from `dot` to `playground`, with `pg` as a short alias. Both `playground` and `pg` invoke the same binary, so `playground init` and `pg init` (and every other subcommand) are interchangeable. The curl installer now symlinks both names onto your PATH and prints a yellow "next step" box showing that either command works. Release artifacts are still published as `dot-<os>-<arch>`; only the installed command names changed. The old `dot` command is no longer installed.
