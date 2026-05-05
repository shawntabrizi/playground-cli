---
"playground-cli": patch
---

`dot mod` no longer prints a misleading `[contracts] No origin configured — using dev fallback (Alice) for query dry-run` warning when the user is signed in via `dot init`. The CDM meta-registry lookup that resolves the live playground registry address now receives the signer's address as `defaultOrigin`. `dot mod` also lazy-probes the picked app's repository between picker dismount and the setup steps, surfacing a clear "private or does not exist" error before any files are written when a publisher has flipped repo visibility after deploying.
