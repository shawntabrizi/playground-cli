---
"playground-cli": patch
---

`dot deploy` and `dot build` now run `pnpm install` (or the project's package manager equivalent) before every build, not just when `node_modules/` is missing. A stale `node_modules/` left over from a branch switch or a lockfile bump used to slip past the missing-folder guard and produce opaque Vite/Rollup errors like `"X is not exported by ..."`; the only fix was to re-run `pnpm install` by hand. The install step is idempotent (~1s when nothing has changed), so the happy path is essentially unaffected.

Also surfaces more of the failing build's output in the CLI error message (40 lines instead of 10), so when a build does fail the actual error line — not just the trailing stack trace — makes it into the rendered output. And the same error no longer renders twice in the deploy TUI: the per-section row marks which step failed with `✕`, and the bottom `deploy failed` row carries the message once.
