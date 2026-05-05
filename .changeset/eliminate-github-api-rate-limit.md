---
"playground-cli": minor
---

Eliminates every remaining `api.github.com` call from the unauthenticated path so `dot mod`, `dot deploy --modable`, and `dot update` no longer contribute to GitHub's 60 req/hour anonymous-IP rate limit. On shared networks (hackathon WiFi, conference NATs) the CLI now works regardless of how many other users are on the same public IP.

- `dot deploy --modable` writes the deploying branch to metadata as `meta.branch` (read via `git rev-parse --abbrev-ref HEAD`). `dot mod` reads that field and constructs the codeload tarball URL directly, skipping the previous `api.github.com/repos/{o}/{r}` lookup. Old apps without `meta.branch` fall back to `main`.
- `assertPublicGitHubRepo` now issues a `HEAD https://github.com/{o}/{r}` against the regular HTML page rather than the API. Same public/private signal (200 vs 404) at zero API quota cost. Anti-abuse limits on the HTML surface are orders of magnitude more generous.
- `dot update` resolves the latest CLI version through jsDelivr's `/resolved` endpoint instead of `api.github.com/.../releases/latest`. The binary download stays on `github.com/.../releases/download/...` (also non-API).

The `gh auth token` opportunistic-header utility and the end-of-`dot init` rate-limit advisory banner are removed — both were workarounds for API quota issues that no longer exist on the unauthenticated path. `gh auth login` is still required for the one remaining authenticated call site (`gh repo create --public --push` when a fresh modable repo is created), and `dot init`'s dependency-list row continues to advise it.
