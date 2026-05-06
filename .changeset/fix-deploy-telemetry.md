---
"playground-cli": patch
---

Fix two telemetry correctness issues in the deploy pipeline: E2E runs now tag bulletin-deploy spans with an `e2e-cli-*` label so test traffic is filterable in dashboards, and `deploy.source` no longer gets incorrectly overwritten with `"playground-cli"` (it correctly reports `"ci"` or `"local"` as intended).
