---
"playground-cli": minor
---

Add `--no-contract-build` flag to `dot deploy`. When set alongside `--contracts`, the deploy uses pre-existing contract artifacts (foundry `out/`, hardhat `artifacts/contracts/`, cdm `target/<crate>.release.polkavm`) instead of running the build toolchain. Useful for CI environments where `forge` / `cargo-contract` aren't installed.
