---
"playground-cli": minor
---

Add an interactive quest browser to `playground mod`. When a track app's source repo ships a `quests.json` at its root, the CLI lists the tutorial quests (id, title, difficulty, dependencies, summary) and waits for you to press "Start tutorial" before continuing into the existing clone flow. The manifest is read from the app's default branch; apps without a `quests.json` (or with an empty quest list) skip the picker silently. The picker is interactive-only — non-TTY runs of `playground mod <domain>` stay fully non-interactive.
