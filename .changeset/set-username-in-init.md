---
"playground-cli": minor
---

`dot init` now prompts you to claim a playground.dot username when one
isn't already set on the registry. If you accept, the CLI signs a
`setUsername` tx against the registry contract and surfaces the chosen
name in the top breadcrumb alongside the command, network, and version.
Runs that find an existing username read it from the registry (best-block
freshness, same as the playground-app) and skip the prompt — your handle
just shows in the header.

Declining is non-destructive: pick "No" and `dot init` continues as
before. The choice is not persisted, so re-running `dot init` will prompt
again until a name is claimed.
