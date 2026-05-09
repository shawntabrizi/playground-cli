---
"playground-cli": patch
---

License the CLI under Apache-2.0. Adds the canonical `LICENSE` text, declares `"license": "Apache-2.0"` in `package.json`, and applies the standard Parity SPDX + copyright header to every tracked source file. CI now runs `scripts/check-license-headers.sh` on every PR (`License Headers` workflow); contributors can run `pnpm lint:license` locally and `./scripts/check-license-headers.sh --fix` to add the header to new files.
