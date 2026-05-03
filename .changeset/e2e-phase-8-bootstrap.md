---
"playground-cli": patch
---

Adds `docs/e2e-bootstrap.md` (public maintainer-facing doc covering pre-conditions, idempotent bootstrap commands, and recovery procedures for the E2E suite) and `.github/workflows/e2e-cleanup.yml` (Sunday 04:00 UTC cron stub for sweeping rotating E2E state — actual sweep logic lands with Phase 5e).
