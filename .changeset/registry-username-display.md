---
"playground-cli": patch
---

`dot init` now shows the user's registry username (the handle set on the
playground.dot profile) when one has been claimed, falling back to the
People-parachain identity name and then to the H160 — same precedence as
the playground-app. Also surfaces an "account in use" row with the
derivation path + H160 so the user can verify the exact account that
signs on their behalf.

No new dependencies. Read-only — silent fallback if the resolved
registry contract doesn't expose `getUsername` (e.g. running against an
older @w3s deploy).
