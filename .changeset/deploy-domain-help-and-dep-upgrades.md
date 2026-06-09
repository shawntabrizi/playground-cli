---
"playground-cli": patch
---

Add an info box to the `playground deploy` domain prompt explaining how name length maps
to the Proof-of-Personhood requirement: a name with a 9-character-or-longer base is open
to everyone and deploys with no personhood check, names of 6 to 8 characters need Proof of
Personhood, and names of 5 or fewer are reserved. The validation rules themselves are
unchanged (a digit suffix must still be exactly two digits).

Upgrade dependencies: `bulletin-deploy` 0.9.0 → 0.10.0 and `@parity/product-sdk-terminal`
0.3.2 → 0.4.0 (both keep host-papp on the 0.8.6 mobile-pairing line), pick up the
`@parity/product-sdk-contracts`/`-keys`/`-tx` patch releases, and refresh the `@parity/cdm-*`
lockfile entries. `product-sdk-descriptors`/`-cloud-storage` are held at their current
versions (the 0.6.0 line only adds the unused Summit env and reintroduces a descriptor
type-skew against `cdm-builder`).
