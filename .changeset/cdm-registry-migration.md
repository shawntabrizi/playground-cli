---
"playground-cli": patch
---

Point `dot deploy --playground` and `dot mod` at the current CDM meta-registry.
The playground-app and playground-constellation migrated to a freshly deployed
meta-registry (`0xf62c…`) where the playground-registry contract was redeployed
with additive lineage methods (`getLineage`/`getLineageCount`). The CLI was still
resolving live contract addresses from the old meta-registry (`0xa7ae…`), so it
published to a stale registry the app no longer reads from. The bundled `cdm.json`
now targets the new meta-registry and the latest `@w3s/playground-registry` ABI,
and `@dotdm/env` is bumped to `2.0.2` so `dot contract` defaults match. The
`publish()` signature is unchanged, so mod lineage continues to flow through the
`modded_from` argument.
