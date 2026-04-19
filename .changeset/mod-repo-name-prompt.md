---
"playground-cli": minor
---

`dot mod` now prompts for the fork repository name after you pick (or pass) an app, with the previously random-suffixed default prefilled — press Enter to keep it, or type your own. The prompt is skipped with `--clone` (the target is only a local directory anyway), with `-y` / `--yes` (non-interactive default), or when you pass `--repo-name <name>` (which also doubles as the scripted override). Supplied names are validated against GitHub's repository-name rules and against existing directories on disk.
