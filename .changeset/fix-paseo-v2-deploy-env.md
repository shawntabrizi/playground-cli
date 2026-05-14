---
"playground-cli": patch
---

Pass the selected deploy environment through to `bulletin-deploy`, pin the paseo-next-v2 capable `bulletin-deploy` prerelease, resolve live CDM contracts through the active `cdm.json` target registry, pass the Asset Hub descriptor to playground registry handles, use the paseo-next-v2 IPFS gateway path for playground metadata reads, use `--suri` signers for DotNS in dev-mode deploys, and treat bare mnemonic SURIs as the root account.
