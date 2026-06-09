---
"playground-cli": patch
---

Refresh contract deploy/install orchestration and add an optional `playground deploy` contracts pre-step (`--contracts` / `--no-contracts`, or an interactive prompt). Headless deploys now require an explicit `--contracts` or `--no-contracts` answer. Contract deploys now preflight CDM registry package ownership so users get a direct rename/use-owner-account error before a deploy batch reverts.
