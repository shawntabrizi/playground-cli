---
"playground-cli": minor
---

`dot mod` now records the source app's domain in `dot.json`, and `dot deploy --playground` publishes it as a `moddedFrom` field in the on-chain metadata. The playground-app can use this to display "Modded from: <domain>" attribution on app detail pages. The value is shape-validated through the same `normalizeDomain` rules as the deploying domain, so a hand-edited `dot.json` can't sneak XSS payloads into shared metadata.
