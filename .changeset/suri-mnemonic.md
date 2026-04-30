---
"playground-cli": minor
---

`dot --suri` now accepts a BIP-39 mnemonic in addition to the dev names (Alice, Bob, Charlie, Dave, Eve, Ferdie). An optional `//<path>` derivation suffix is supported, e.g. `dot deploy --suri "<12-word phrase>//0"`. The dev-name fast path is unchanged.
