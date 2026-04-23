---
"playground-cli": patch
---

Upgrade `bulletin-deploy` pin to `0.7.2`. Fewer spurious upload failures now that the default chunk timeout covers Bulletin's 24s Aura slots, and a Bun-safe memory-report teardown upstream. No API changes on our side.
