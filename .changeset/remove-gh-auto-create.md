---
"playground-cli": minor
---

`dot deploy --modable` no longer auto-creates a GitHub repository. The CLI now requires the user to set up a public GitHub `origin` themselves and fails with a clear message if `origin` is unset, points to a private repo, or points to a non-GitHub URL. The `--repo-name` flag is removed, the `gh` CLI dependency is dropped (no longer installed by `dot init`, no longer probed for authentication), and `dot mod` now initialises an empty git history without a baseline commit so users can stage and commit their first revision however they like.
