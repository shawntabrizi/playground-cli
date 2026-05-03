---
"playground-cli": patch
---

Failed E2E cells now surface forensic detail (CLI subprocess stdout/stderr from `dot-runs.log`, junit.xml failure messages, and `::error::` annotations at the top of the run page) directly in the GH Actions UI. Previously a triager had to download the artefact and untar it locally to see the real root cause. Closes #98.
