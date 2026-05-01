---
"playground-cli": patch
---

Avoid GitHub auth and `git push` during `dot deploy --modable` when the project already has an `origin`; the existing repository URL is recorded directly.
