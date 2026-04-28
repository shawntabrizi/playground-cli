---
"playground-cli": patch
---

Bumped `bulletin-deploy` 0.7.2 → 0.7.6. The new release ships heartbeat-consistency fixes on the WS clients used during preflight tx submission (eliminates the no-heartbeat `withAliceApi` path) plus a new bounded reconnect-status handler. Includes a temporary `pnpm.overrides` workaround for a transitive publish bug in `@parity/dotns-cli@0.5.6` that prevents pnpm from installing 0.7.4+ cleanly; see CLAUDE.md for context and removal criteria.
