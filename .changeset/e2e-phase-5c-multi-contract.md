---
"playground-cli": patch
---

Nightly E2E now exercises the multi-contract publish path: `nightly-deploy-multi` cell publishes both `TokenA.sol` and `TokenB.sol` from the multi-contract fixture to the `e2e-cli-multi.dot` domain, exercising the batch contract-instantiate path. Refactored the 3 near-identical contract-deploy tests (foundry, hardhat, multi) into a shared `runContractDeployTest` helper.
