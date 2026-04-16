# playground-cli

## 0.3.0

### Minor Changes

- ba4f091: - `dot init` now runs account setup after QR login + toolchain install: funds the account from Alice (testnet), signs `Revive.map_account` via the mobile wallet, and grants bulletin allowance.
  - New `dot update` command — self-updates from GitHub releases with atomic write-then-rename, safe to run over the live binary.
  - Session signer now routes transactions through `signPayload` to avoid the mobile's `<Bytes>` wrap that produced `BadProof` on-chain.
  - Connection singleton with a 30 s timeout and preserved `Error.cause` for debugging.
  - `install.sh` propagates the exit code of the auto-run `dot init`.
  - Introduced a vitest suite (73 tests across 9 files).

## 0.2.0

### Minor Changes

- 23abf79: Scaffold init, mod, build, and deploy commands

## 0.1.1

### Patch Changes

- 8a0e3cc: Initial CLI setup
