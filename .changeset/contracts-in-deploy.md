---
"playground-cli": minor
---

Add optional contract deploy step to `dot deploy`. When the project root contains a `foundry.toml`, a `hardhat.config.*`, or a `Cargo.toml` with a `pvm_contract` dep, the TUI now asks "deploy contracts?" (default no), and `dot deploy --contracts` runs it non-interactively. All three paths compile locally (foundry via `forge build --resolc`, hardhat via `npx hardhat compile`, cdm via `@dotdm/contracts`) and then hand the PolkaVM bytecode to cdm's `ContractDeployer.deployBatch`, which weight-aware-chunks the deploys into `Utility.batch_all` extrinsics signed by the same signer used elsewhere in the deploy (your phone session, or `//Alice` in `--signer dev`). No constructor args, no contract registry publish, no on-chain metadata in this first cut — they'll land in a follow-up.

`dot init` gains a `foundry (polkadot)` dependency check that installs `foundryup-polkadot`.
