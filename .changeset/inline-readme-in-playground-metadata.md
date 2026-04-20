---
"playground-cli": minor
---

`dot deploy --playground` now inlines the project's `README.md` into the playground metadata so published apps show a rendered readme on their detail page. Readmes up to 20 KB are included automatically; if the file is larger the confirm screen shows a warning ("readme will not be uploaded") and the deploy proceeds without it. No action required — this works for any repo that already has a `README.md` at its root.
