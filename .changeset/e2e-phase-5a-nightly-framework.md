---
"playground-cli": patch
---

E2E suite now has a `test-nightly-no-publish` matrix that runs only on the daily schedule (06:00 UTC) and `workflow_dispatch`. Adds two nightly-only cells: `nightly-mod-miss` (registry-miss path for unknown domains) and `nightly-diagnostic` (DOT_DEPLOY_VERBOSE / DOT_MEMORY_TRACE coverage). Per-PR runs are unaffected.
