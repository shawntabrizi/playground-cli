---
"playground-cli": minor
---

`dot deploy` now asks whether to run the build step before deploying, defaulting to "yes" so the common case is still a single Enter press. Pass `--no-build` to skip the build non-interactively (useful when you've already built the project and just want to re-upload existing artifacts from `buildDir`). The confirm screen and headless summary both show whether the run will rebuild or reuse existing artifacts.
