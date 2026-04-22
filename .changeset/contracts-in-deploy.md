---
"playground-cli": minor
---

Add optional contract deploy step to `dot deploy`. When the project root contains a `foundry.toml`, a `hardhat.config.*`, or a `Cargo.toml` with a `pvm_contract` dep, the TUI now asks "deploy contracts?" (default no), and `dot deploy --contracts` runs it non-interactively. All three paths compile locally (foundry via `forge build --resolc`, hardhat via `npx hardhat compile`, cdm via `@dotdm/contracts`) and then hand the PolkaVM bytecode to cdm's `ContractDeployer.deployBatch`, which weight-aware-chunks the deploys into `Utility.batch_all` extrinsics. No constructor args, no contract registry publish, no on-chain metadata in this first cut — they'll land in a follow-up.

Contract extrinsics are signed by a persistent on-disk **session key** at `~/.polkadot/accounts.json`, not the mobile signer — today's mobile flow can't handle the encoded size of a batched contract deploy, and the failure is miscategorised as a user-cancel. On first deploy the session key is funded by the user's main signer (one phone tap) or by Alice in pure dev mode; subsequent runs skip funding when the balance is already above the threshold.

`dot init` gains a `foundry (polkadot)` dependency check that installs `foundryup-polkadot`.
