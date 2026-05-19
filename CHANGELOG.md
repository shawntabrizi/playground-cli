# playground-cli

## 0.22.4

### Patch Changes

- 9f1e4dc: Make `dot init` survive Bulletin allowance propagation lag, and fix a React setState warning that landed in the previous account-derivation PR.

  - **`dot init` no longer aborts** when the RFC-0010 Bulletin slot account is returned by mobile but the on-chain authorization hasn't propagated to Bulletin Chain yet. The slot key + marker are persisted regardless (so the next `dot deploy` picks them up), and the funding/mapping step continues to run. The row shows a soft-failure warning with the slot account SS58 and a faucet URL.
  - New `BULLETIN_AUTHORIZATION_URL` + `bulletinAuthorizationHelp(slotAddress)` so timeout / cached-key-not-authorized errors point at `https://paritytech.github.io/polkadot-bulletin-chain/authorizations` with the exact slot SS58 to authorize manually.
  - `requestAndStoreBulletinAllowanceSigner` persists the slot key before waiting for chain confirmation. A propagation timeout no longer discards a valid key the mobile already derived.
  - `storeSlotAccountKeysFromOutcomes` is now a single read-modify-write so two slot keys returned in one call (e.g. BulletInAllowance + StatementStoreAllowance) can't race-clobber each other in `allowance-keys.json`.
  - Fix a "Cannot update a component while rendering a different component" warning from `QrLogin`: it was calling the parent's `onDone(setState)` from inside `setStatus(updater)`. The handler now captures the resolved addresses in a `useRef` and calls `onDone` after the promise resolves, outside any updater function.

## 0.22.3

### Patch Changes

- b6cbcc2: Fix the `dot init` identity block:

  - Stop double-deriving the product account. The "product account" line previously ran `deriveProductAccountPublicKey` on the already-product-derived SS58, producing a ghost address whose SS58 + H160 didn't match what the playground-app actually uses. Both are now taken straight off the auth-derived pubkey via a shared `derivePlaygroundProductPublicKey` helper, so the signer that signs on-chain and the display the user sees can no longer drift.
  - Show the SSO wallet root on the "logged in" line instead of the product account. The product account is on its own row underneath with the full SS58 + H160. The root is also what the username lookup is keyed on.
  - Fix the username lookup key. Usernames live at `Resources.Consumers[<rootAccountId>]` on the People parachain; the lookup was previously running against the product account and would never find a match. It now uses the wallet root, matching polkadot-desktop's `useSessionIdentity`.

## 0.22.2

### Patch Changes

- 6f97144: Fix `dot init` identity block: print the full product-account SS58 and 0x-prefixed H160 instead of truncated `5DHk4g...CzE1 (0x8849...29dc)`, and fix the username lookup so it actually queries `Resources.Consumers` correctly. The previous code routed the SS58 through `AccountId().dec(...)` (which is meant for `0x`-hex input, not SS58) and silently corrupted the storage key, so every lookup surfaced as `(lookup failed)`. Now the SS58 is passed straight to `getValues`, matching the polkadot-desktop / dotli / triangle-js-sdks pattern.

## 0.22.1

### Patch Changes

- 7d7e7eb: Internal: bump `@parity/product-sdk-*` packages and `bulletin-deploy` to current latest, and consume `deriveProductAccountPublicKey` from `@parity/product-sdk-keys` instead of a local mirror. No user-visible behaviour change; output is byte-identical for production inputs.

## 0.22.0

### Minor Changes

- f618038: `dot init` now shows your username and your product account address alongside the existing "logged in" confirmation.

  - **Username** comes from your on-chain identity on People parachain (`Resources.Consumers` storage). If you haven't registered a username yet you'll see `(no username set on chain)`; if the lookup fails or times out (5s) it falls back to `(lookup failed)`.
  - **Product account** is the SS58 + truncated H160 derived locally from your root account via the same sr25519 soft-derivation path that the mobile wallet uses privately. The address you see here is the SAME one `playground-app` resolves for "My apps" and the SAME one your CLI signs as on-chain — so a quick eyeball is enough to confirm both clients agree on your identity.

## 0.21.5

### Patch Changes

- d8fbc44: Use cached RFC-0010 Bulletin allowance keys for Playground metadata uploads instead of signing Bulletin storage with the product account.

## 0.21.4

### Patch Changes

- 2ad4a8e: Fix `dot init` and `dot deploy --signer phone` to target the same product-derived account that actually signs on-chain.

  `session.remoteAccount.accountId` carries the user's wallet account, not the per-app product account the mobile signs with. The CLI was funding / allowance-marking / displaying the wallet address while the chain saw a different `From`. The CLI now soft-derives the product-account public key locally from `session.rootAccountId` using the same `"/product/{productId}/{derivationIndex}"` path the mobile wallet derives privately, so all three flows (`dot init`, `dot deploy --signer phone`, and the deployed playground-app's `HostProvider.getProductAccount`) resolve to the SAME SS58 for a given user. `PLAYGROUND_PRODUCT_ID` is also aligned to `"playground.dot"` to match the deployed playground-app.

  The deploy summary now shows the signing SS58 (e.g. `Signer  Your phone signer (5HRBs5…)`) so users can verify the account before approving. Bulletin-deploy's preflight log line that showed the dev-master fallback address (`SS58 Address: 5DfhG…`) during the availability check is silenced; only the real deploy's signing address surfaces.

## 0.21.3

### Patch Changes

- efca48c: Bump `bulletin-deploy` from `0.7.20-rc.4` to `0.7.20` stable. The notable change vs rc.4 is PR #369, which lands inside bulletin-deploy the same testnet pre-funding pattern `dot init` adopted in the previous release: `DotNS.connect({ autoAccountMapping: true })` now internally tops up a low-balance signer (`attemptTestnetTopUp` from the bare-master / `//Bob` of the standard dev mnemonic) before submitting the Revive auto-map trigger on paseo-next-v2. Users who skip `dot init` and run `dot deploy` directly will now get the funding just-in-time from bulletin-deploy; users who run `dot init` first get the same outcome front-loaded by the CLI. Both paths no-op when the recipient already holds ≥0.1 PAS, so they don't double-transfer.

## 0.21.2

### Patch Changes

- 4526267: `dot init` now funds the product-derived account from the shared bulletin-deploy dev signer (1 PAS, idempotent: skipped when the recipient already holds ≥0.1 PAS) instead of submitting an explicit `Revive.map_account`. paseo-next-v2's `pallet_revive::AutoMapper` handles the SS58 ↔ H160 mapping on the first state-changing tx; the funding step gives that tx enough PAS to land. A belt-and-braces `Revive.map_account` still fires if `checkMapping` returns false after funding, so cold-start accounts that pre-existed the AutoMapper runtime upgrade aren't left stuck.

  Also silences the recurring `DestroyedError: Client destroyed` block printed on every `dot init` exit. Root cause was `@sentry/node`'s default `OnUnhandledRejection` integration printing the rejection via `console.warn` + `console.error`; we now override it with `mode: 'none'` so Sentry still captures the rejection with the full `mechanism: onunhandledrejection` metadata but skips the print. Benign polkadot-api teardown artifacts are dropped via `beforeSend` so they don't reach the Failures dashboard either.

## 0.21.1

### Patch Changes

- baa84fa: Pass the selected deploy environment through to `bulletin-deploy`, pin the paseo-next-v2 capable `bulletin-deploy` prerelease, resolve live CDM contracts through the active `cdm.json` target registry, pass the Asset Hub descriptor to playground registry handles, use the paseo-next-v2 IPFS gateway path for playground metadata reads, use `--suri` signers for DotNS in dev-mode deploys, and treat bare mnemonic SURIs as the root account.

## 0.21.0

### Minor Changes

- b228817: Migrate to paseo-next-v2 (Asset Hub Next 1500, Bulletin Next 1501, People Next System 1502). `dot init` now requests RFC-0010 resource allowances (Bulletin + Statement Store + smart-contract gas) from the user's mobile wallet before mapping the account; PAS funding from a dedicated funder account is gone. Grants are cached at `~/.polkadot/allowances.json` (per env, per address, per resource) so repeat `dot init` runs don't re-prompt. `dot mod` no longer requires login or account-mapping to browse moddable apps.

  Behind the scenes: bumped `bulletin-deploy` to 0.7.19 (ships the paseo-next-v2 env with `autoAccountMapping`/`bulletinAuthorizeV2`/`skipDotnsCli` flags), `@parity/product-sdk-*` to the 0.5.0 facade release (PAPI-native signer fixes `AsPgas` signed-extension support), `@dotdm/contracts` to ^2.0.3, `@novasamatech/*` overrides to 0.7.9-4.

## 0.20.3

### Patch Changes

- 6bf3e42: install.sh now runs `dot init --yes` (non-interactive dep setup) instead of blocking on the mobile QR scan. A follow-up hint tells users to run `dot init` for the full login flow.

## 0.20.2

### Patch Changes

- 40d860b: License the CLI under Apache-2.0. Adds the canonical `LICENSE` text, declares `"license": "Apache-2.0"` in `package.json`, and applies the standard Parity SPDX + copyright header to every tracked source file. CI now runs `scripts/check-license-headers.sh` on every PR (`License Headers` workflow); contributors can run `pnpm lint:license` locally and `./scripts/check-license-headers.sh --fix` to add the header to new files.

## 0.20.1

### Patch Changes

- a66d4a1: Bump `bulletin-deploy` to `0.7.14`. Internal hardening of the chunked-storage path against WS-halt allocation storms: per-deploy retry-budget circuit breaker, recovery batch-size drop (2→1 in flight after first reconnect), and a synchronous WS-close hook that destroys the PAPI client before its broadcast-replay loop can OOM. No public-API changes.

## 0.20.0

### Minor Changes

- 0b5960c: Migrate the CLI runtime from `@polkadot-apps/*` packages to `@parity/product-sdk-*`, including terminal product-account signing for `playground.dot`. The QR-paired session signer routes transaction signing through `session.signPayload` (no `<Bytes>` envelope) so the chain accepts the produced signature, and arbitrary-byte signing through `session.signRaw` (envelope applied by mobile, correct for free-form data). Product-SDK packages use caret ranges so upstream patch and minor releases land automatically on a fresh `pnpm install`.

### Patch Changes

- dc9eead: Purge `@polkadot-apps/*` from the dependency tree. `@dotdm/contracts` is pinned to `1.1.1-dev.1778274929` (the dev release from the CDM monorepo's product-sdk migration PR; the `latest` stable still pulls the legacy stack), and `@novasamatech/*` is forced to `0.7.8-2` via `pnpm.overrides` so transitive consumers come along. `grep '@polkadot-apps/' pnpm-lock.yaml` now returns zero hits. The runtime is effectively PAPI 2.x-only — the lockfile still mentions `polkadot-api@1.23.3` but only as a vestigial declaration of the bundled `@parity/dotns-cli` CLI binary, which inlines its deps and never resolves them at runtime.
- ac4aaaa: Migrate the diagnostic tools (`tools/list-registry-apps.ts`, `tools/probe-registry-resolution.ts`) off direct `@polkadot-apps/*` imports onto `@parity/product-sdk-{contracts,tx,address}`. The list-registry-apps script now hits Paseo's public IPFS gateway directly (since `@parity/product-sdk-bulletin`'s `queryJson` is host-only and these tools run as plain Bun processes). Adds a CI grep guard so direct `@polkadot-apps/*` imports under `src/`, `e2e/`, `scripts/`, `tools/` fail the Format job.
- 2398dce: Upgrade `bulletin-deploy` from `0.7.12` to `0.7.13`. The new release adds a `--env <id>` selector to the upstream CLI binary plus additive deploy span attributes (`deploy.env`, `deploy.network`, `deploy.environments_source`); library consumers see zero behaviour change and the default endpoint resolves to the same paseo-next WSS as before.
- cfc487c: Upgrade `@parity/product-sdk-terminal` to `^0.2.0` and the rest of `@parity/product-sdk-*` to their latest patch releases. The new terminal release includes both fixes the CLI was working around: (1) `createSessionSignerForAccount` now uses a split-callback PJS signer (tx → `session.signPayload`, bytes → `session.signRaw`), so the local PJS-based replacement we'd inlined is gone; (2) `destroy()` is now async and drains pending statement-subscription unsubscribes before tearing down the lazy client, eliminating the `DestroyedError: Client destroyed` unhandled rejection on `dot logout`. The CLI's local helpers and the `DestroyedError` entry in `isBenignUnsubscriptionError` are removed accordingly.

## 0.19.5

### Patch Changes

- a5385ba: Upgrade bulletin-deploy from 0.7.10 to 0.7.12.

## 0.19.4

### Patch Changes

- 33bef5c: Improve error reporting when the CDM meta-registry fails to return a live contract address.

## 0.19.3

### Patch Changes

- e3c587f: Read current Bulletin authorization allowance fields correctly during deploy preflight.

## 0.19.2

### Patch Changes

- 1dfc53d: Rename the deploy source-publishing option and related CLI language to moddable.

## 0.19.1

### Patch Changes

- 8f1007c: Preserve explicit installer VERSION overrides such as dev branch release tags.

## 0.19.0

### Minor Changes

- 10b2abf: `dot deploy --moddable` no longer auto-creates a GitHub repository. The CLI now requires the user to set up a public GitHub `origin` themselves and fails with a clear message if `origin` is unset, points to a private repo, or points to a non-GitHub URL. The `--repo-name` flag is removed, the `gh` CLI dependency is dropped (no longer installed by `dot init`, no longer probed for authentication), and `dot mod` now initialises an empty git history without a baseline commit so users can stage and commit their first revision however they like.

## 0.18.2

### Patch Changes

- a4ef800: Fix two telemetry correctness issues in the deploy pipeline: E2E runs now tag bulletin-deploy spans with an `e2e-cli-*` label so test traffic is filterable in dashboards, and `deploy.source` no longer gets incorrectly overwritten with `"playground-cli"` (it correctly reports `"ci"` or `"local"` as intended).

## 0.18.1

### Patch Changes

- 7373966: Update `bulletin-deploy` to 0.7.10 for the latest DotNS/deploy fixes.

## 0.18.0

### Minor Changes

- 82036ef: Eliminates every remaining `api.github.com` call from the unauthenticated path so `dot mod`, `dot deploy --moddable`, and `dot update` no longer contribute to GitHub's 60 req/hour anonymous-IP rate limit. On shared networks (hackathon WiFi, conference NATs) the CLI now works regardless of how many other users are on the same public IP.

  - `dot deploy --moddable` writes the deploying branch to metadata as `meta.branch` (read via `git rev-parse --abbrev-ref HEAD`). `dot mod` reads that field and constructs the codeload tarball URL directly, skipping the previous `api.github.com/repos/{o}/{r}` lookup. Old apps without `meta.branch` fall back to `main`.
  - `assertPublicGitHubRepo` now issues a `HEAD https://github.com/{o}/{r}` against the regular HTML page rather than the API. Same public/private signal (200 vs 404) at zero API quota cost. Anti-abuse limits on the HTML surface are orders of magnitude more generous.
  - `dot update` resolves the latest CLI version through jsDelivr's `/resolved` endpoint instead of `api.github.com/.../releases/latest`. The binary download stays on `github.com/.../releases/download/...` (also non-API).

  The `gh auth token` opportunistic-header utility and the end-of-`dot init` rate-limit advisory banner are removed — both were workarounds for API quota issues that no longer exist on the unauthenticated path. `gh auth login` is still required for the one remaining authenticated call site (`gh repo create --public --push` when a fresh moddable repo is created), and `dot init`'s dependency-list row continues to advise it.

  `install.sh` is updated to resolve the latest tag through jsDelivr first (with the github.com `releases/latest` redirect probe as fallback) so concurrent first-time installs at a hackathon — every attendee on the same NAT — never touch `api.github.com` at all. The previous `api.github.com/repos/.../releases?per_page=1` fallback is removed entirely.

## 0.17.0

### Minor Changes

- eb9760c: Every `dot` invocation now shows a one-line "Update available" banner at the bottom when a newer release exists. The check resolves the latest version through jsDelivr's free public CDN (not GitHub's rate-limited API) with a 1 s timeout, so a flaky network never delays the command. Suppressed in CI / piped output, when running `dot update` itself, and when `DOT_NO_UPDATE_CHECK=1`.

  `dot mod` and `dot deploy --moddable` now opportunistically pass an `Authorization: Bearer <token>` header read from `gh auth token` when available — logged-in users get GitHub's per-user 5000/hour quota instead of contributing to the shared 60/hour anonymous-IP quota that gets exhausted quickly on hackathon WiFi. Anonymous users continue to work as before.

  `dot deploy --moddable` now fails with an explicit "GitHub rate limit exceeded — run `gh auth login`" error when the public-repo preflight is denied by the rate limiter, instead of silently passing the check and risking a private repo being published as moddable. Ambiguous 403s and transient 5xx responses still skip the check (unchanged).

  `dot init` ends with an explicit advisory banner (visually consistent with the new "Update available" banner) explaining the IP-based GitHub rate limit and recommending `gh auth login`, but only when the user is not currently authed. The single-row dependency-list warning was too terse to convey why this matters on hackathon / shared-network setups.

### Patch Changes

- fe6fe64: `dot mod` no longer prints a misleading `[contracts] No origin configured — using dev fallback (Alice) for query dry-run` warning when the user is signed in via `dot init`. The CDM meta-registry lookup that resolves the live playground registry address now receives the signer's address as `defaultOrigin`. `dot mod` also lazy-probes the picked app's repository between picker dismount and the setup steps, surfacing a clear "private or does not exist" error before any files are written when a publisher has flipped repo visibility after deploying.

## 0.16.17

### Patch Changes

- 88d78d3: `dot deploy --moddable` now rejects private GitHub repositories at preflight with a clear error message instead of silently failing later. `dot mod` also surfaces a more actionable error when it encounters a private or non-existent repository instead of the misleading "pin one in metadata.branch" hint.

## 0.16.16

### Patch Changes

- d742e7d: Fix `dot init` failing on a clean macOS/Linux machine where `rustup` isn't yet installed. The rustup installer writes its binaries to `~/.cargo/bin` and adds that directory to PATH only via shell rc files, which doesn't reach the running `dot` process. The next two steps (`Rust nightly`, `rust-src`) then fail with `bash: rustup: command not found`. After installing rustup we now prepend `$CARGO_HOME/bin` (default `~/.cargo/bin`) to `process.env.PATH` so the rest of `dot init` can resolve `rustup` immediately.

## 0.16.15

### Patch Changes

- 1988832: Remove unreachable null-signer guard in `resolveSignerSetup` (`signerMode.ts`). The dead `throw` could never fire because `shouldResolveUserSigner()` guarantees a signer is resolved before `resolveSignerSetup` is called when `--playground` is set. No user-visible behaviour change.

## 0.16.14

### Patch Changes

- b071fff: Adds `docs/e2e-running-tests.md` covering how to trigger the E2E suite locally and on GitHub. Tables of triggers, modes, flag passthrough, and result-reading. Complements `docs/e2e-bootstrap.md` (maintainer one-time setup).

## 0.16.13

### Patch Changes

- 8af7042: Fixed misleading "📱 Approve on your phone" log line during `dot deploy --signer dev --suri X --playground`. The session-key funding step now signs directly with the dev keypair instead of wrapping it in the phone-mode signing-event proxy. Phone-session deploys are unchanged.

## 0.16.12

### Patch Changes

- b9044f0: Fixed an intermittent `Revive::AccountUnmapped` failure during contract deploys. The per-deploy session key is now persisted to `~/.config/dot/accounts.json` only AFTER its `map_account` extrinsic is confirmed on chain. Previously the persist happened first, so a failing `map_account` (e.g. nonce race, transient chain error) left the on-disk state lying — the retry would find the existing key, skip the mapping step, and fail at the dry-run with AccountUnmapped. Fixes #94.

## 0.16.11

### Patch Changes

- 635ca56: CI now validates the consumer install path after every stable release: `e2e-post-release.yml` fires on `release: published`, runs `install.sh`, and runs the same smoke tests as `e2e-release.yml` (Phase 7) but against the installed binary at `~/.polkadot/bin/dot`. Catches `install.sh` regressions that the prerelease/SEA-download path doesn't.
- e56f7a9: Adds `docs/e2e-bootstrap.md` (public maintainer-facing doc covering pre-conditions, idempotent bootstrap commands, and recovery procedures for the E2E suite) and `.github/workflows/e2e-cleanup.yml` (Sunday 04:00 UTC cron stub for sweeping rotating E2E state — actual sweep logic lands with Phase 5e).

## 0.16.10

### Patch Changes

- df38cfa: Adds `DOT_BULLETIN_RPC` env-var override to `getChainConfig()`, allowing tests (or operators in an emergency) to prepend a custom Bulletin RPC endpoint while keeping the built-in URL as a fallback. The new `nightly-chaos-rpc` cell exercises this by setting an unroutable primary URL and asserting the deploy still completes via failover.

## 0.16.9

### Patch Changes

- c5bcff6: CI now validates published RC binaries: a new `e2e-release.yml` workflow fires on `release: prereleased`, downloads the `dot-linux-x64` SEA asset, and runs `e2e/cli/published.test.ts` smoke tests (`--version`, `--help`). Catches packaging regressions before stable release.

## 0.16.8

### Patch Changes

- b591ef3: E2E test setup and bootstrap-tool log strings now correctly use PAS (Paseo's native token symbol) instead of DOT. The numeric values are unchanged (1 PAS = 10^10 plancks); only the displayed unit symbol changes. Closes #96.

## 0.16.7

### Patch Changes

- 492ace6: Failed E2E cells now surface forensic detail (CLI subprocess stdout/stderr from `dot-runs.log`, junit.xml failure messages, and `::error::` annotations at the top of the run page) directly in the GH Actions UI. Previously a triager had to download the artefact and untar it locally to see the real root cause. Closes #98.
- 68f6417: `dot update` now creates its install directory if missing instead of failing with ENOENT. Previously the directory was assumed to exist (created by `install.sh` during `dot init`), causing `dot update` to fail on environments that didn't run the installer (e.g. CI runners spawning the CLI directly). Fixes #97.

## 0.16.6

### Patch Changes

- 22c0e59: Nightly E2E now exercises the SIGINT cleanup path: a new `nightly-chaos-sigint` cell sends SIGINT to `dot deploy` mid-flight and asserts the process-guard's runAllCleanupAndExit handler exits cleanly within 5s with code 130 (or SIGINT signal).

## 0.16.5

### Patch Changes

- 5c4b491: Nightly E2E now exercises the `--no-contract-build` error path: a new `nightly-rejections` cell asserts the integration-level error message when a Foundry project requests skip-build but ships no pre-built artefacts under `out/`.

## 0.16.4

### Patch Changes

- 3751335: Nightly E2E now exercises the multi-contract publish path: `nightly-deploy-multi` cell publishes both `TokenA.sol` and `TokenB.sol` from the multi-contract fixture to the `e2e-cli-multi.dot` domain, exercising the batch contract-instantiate path. Refactored the 3 near-identical contract-deploy tests (foundry, hardhat, multi) into a shared `runContractDeployTest` helper.

## 0.16.3

### Patch Changes

- e5b1b19: Nightly E2E now exercises the Hardhat (EVM) full-deploy path: a new `nightly-deploy-hardhat` cell publishes the hardhat fixture's pre-built `Lock.sol` bytecode to the `e2e-cli-hardhat.dot` domain on Paseo. Runs on schedule/dispatch only (max-parallel: 1 with `pr-deploy-frontend`/`pr-deploy-foundry` since they share SIGNER), so per-PR runtime is unaffected.

## 0.16.2

### Patch Changes

- ac3addc: E2E suite now has a `test-nightly-no-publish` matrix that runs only on the daily schedule (06:00 UTC) and `workflow_dispatch`. Adds two nightly-only cells: `nightly-mod-miss` (registry-miss path for unknown domains) and `nightly-diagnostic` (DOT_DEPLOY_VERBOSE / DOT_MEMORY_TRACE coverage). Per-PR runs are unaffected.

## 0.16.1

### Patch Changes

- 28d7c30: E2E suite now runs as a 7-cell matrix on CI: 4 no-publish cells in parallel + 3 publish cells serial (sharing the registry signer to avoid nonce races). Adds full-deploy tests for the Foundry and CDM backends. Per-cell pass/fail is visible in the sticky PR comment with cell-specific JUnit + forensic logs.

## 0.16.0

### Minor Changes

- 8d02aa4: Add `--no-contract-build` flag to `dot deploy`. When set alongside `--contracts`, the deploy uses pre-existing contract artifacts (foundry `out/`, hardhat `artifacts/contracts/`, cdm `target/<crate>.release.polkavm`) instead of running the build toolchain. Useful for CI environments where `forge` / `cargo-contract` aren't installed.

## 0.15.5

### Patch Changes

- 7696da3: CI now posts a sticky E2E test-pass comment on every PR with per-test pass/fail counts and Sentry triage links. Nightly schedule failures auto-open a GitHub issue. Per-cell forensic logs (`dot-runs.log`) and JUnit XML are uploaded as workflow artefacts. Test traffic is tagged with `cli.tag:e2e-ci-{pr|nightly|dispatch}` so production Sentry dashboards can filter it out.

## 0.15.4

### Patch Changes

- 7151157: Avoid GitHub auth and `git push` during `dot deploy --moddable` when the project already has an `origin`; the existing repository URL is recorded directly.

## 0.15.3

### Patch Changes

- 9d0a0ba: Load the logged-in account for `dot deploy --signer dev --playground` so Playground registry publishes can be signed by the app owner.

## 0.15.2

### Patch Changes

- f2f43c4: Suppress the non-fatal `ReviveApi_trace_call` compatibility stack during Playground registry contract dry-runs.

## 0.15.1

### Patch Changes

- 2de1408: Resolve the Playground registry address from the live CDM meta-registry before publishing or browsing apps.

## 0.15.0

### Minor Changes

- 86abd07: `dot --suri` now accepts a BIP-39 mnemonic in addition to the dev names (Alice, Bob, Charlie, Dave, Eve, Ferdie). An optional `//<path>` derivation suffix is supported, e.g. `dot deploy --suri "<12-word phrase>//0"`. The dev-name fast path is unchanged.

### Patch Changes

- 934c0db: Add E2E integration test suite covering install, build, init, session, deploy, mod, and diagnostic commands. Tests spawn the CLI as a child process via execa and assert on stdout/stderr/exit codes. Deploy tests verify contract detection for Foundry, Hardhat, and CDM backends. Includes CI workflow, fixture projects, and chain query helpers for Paseo testnet validation.
- 21481ba: Fix `dot deploy` exiting 1 after a successful deploy. polkadot-api's `client.destroy()` can fire a `DisjointError: ChainHead disjointed` from a still-in-flight chainHead operation after the WS has closed, which surfaces as an unhandled rejection and forced the process to exit 1 even though the deploy completed and printed "Deploy complete". Now suppressed alongside the existing benign-teardown filter for `UnsubscriptionError: Not connected`.
- ba63fec: Fix `dot deploy` and `dot mod` exiting 0 on failures. Previously the CLI's entry point unconditionally called `process.exit(0)` after the action returned, overwriting the non-zero `process.exitCode` set by `scheduleHardExit()` (deploy preflight, e.g. `SignerNotAvailableError` from a corrupt session) and never set by `dot mod` at all on `runSetup` failures (e.g. registry miss). Both paths now propagate a non-zero exit code so shell scripts and CI pipelines can rely on the result.

## 0.14.1

### Patch Changes

- 90f51d4: Fix bundled DotNS CLI dispatch so compiled deploys can run DotNS subprocess commands.

## 0.14.0

### Minor Changes

- 1349115: Add privacy-gated Sentry telemetry for `dot` commands and route `bulletin-deploy` spans through the CLI's ambient Sentry client.

## 0.13.2

### Patch Changes

- 6715aa2: Bumped `bulletin-deploy` 0.7.2 → 0.7.6. The new release ships heartbeat-consistency fixes on the WS clients used during preflight tx submission (eliminates the no-heartbeat `withAliceApi` path) plus a new bounded reconnect-status handler. Includes a temporary `pnpm.overrides` workaround for a transitive publish bug in `@parity/dotns-cli@0.5.6` that prevents pnpm from installing 0.7.4+ cleanly; see CLAUDE.md for context and removal criteria.
- 9d3be83: The memory-watchdog abort message now reliably reaches stderr when the output is redirected to a file. Previously, on a SIGKILL-on-memory-cap path, the `✖ Memory use exceeded …` message could be lost from a redirected stderr buffer because `process.stderr.write()` queues through the writable-stream layer. The watchdog now uses `fs.writeSync(2, …)`, a blocking syscall that completes before the kill, so users diagnosing memory issues see the full abort context.

## 0.13.1

### Patch Changes

- f2e09bd: Bump `@w3s/playground-registry` to v6 to match the first release of playground.dot.

## 0.13.0

### Minor Changes

- b9ec23b: `dot mod` now downloads source as a fresh project from GitHub via HTTPS — multiple mods of the same starter no longer collide via GitHub's one-fork-per-account limit. `git` and `gh` are no longer required to mod an app.

  `dot deploy --playground` now asks before publishing source. Pass `--moddable` (or answer "yes" to the prompt) to publish a public GitHub source repo alongside the deploy so others can `dot mod` it. Use `--no-moddable` to skip the prompt non-interactively. The default is non-moddable. Pass `--repo-name <name>` to skip the repo-name prompt when creating a fresh repo.

  The interactive registry picker (`dot mod` with no domain) now hides apps that aren't moddable.

  Removed: `dot mod --clone`, `--repo-name`, `--yes` flags (no longer needed).

## 0.12.0

### Minor Changes

- f6e5adf: `dot mod` now keeps the tail of `setup.sh` visible after the step completes — the script's "next steps" / quest progression / doc pointers no longer disappear when the step turns green. The full unfiltered output is also tee'd to `<targetDir>/.dot-mod-setup.log` for any output that doesn't fit the on-screen tail. The generic "edit with claude / dot deploy" footer now only prints when the app didn't ship a `setup.sh`.

## 0.11.1

### Patch Changes

- 0dfb9b5: `dot mod` no longer leaves an `upstream` remote behind after fork+clone, so `git checkout quest/level-N` (and the commands printed by tutorial `setup.sh` scripts) work without `--track origin/<name>` workarounds.

## 0.11.0

### Minor Changes

- 60463f7: Add `dot logout` to sign out of the account paired via `dot init` — no more `rm -rf ~/.polkadot-apps`. Notifies the mobile app so the paired-connection entry is removed there too, with a best-effort local-only cleanup fallback when the network is unreachable.

## 0.10.4

### Patch Changes

- 20bdd11: Refresh remaining `@polkadot-apps/*` direct dependencies to their current latest. PR #44 narrowly bumped `chain-client`; this widens to pick up the siblings that the monorepo had already co-released via its `workspace:*` + changesets patch cascade:

  - `@polkadot-apps/bulletin` 0.6.9 → 0.6.10
  - `@polkadot-apps/contracts` 0.3.2 → 0.4.0

  Also eliminates the duplicate `chain-client@2.0.4` that was being pulled transitively by the old bulletin — single resolved version now (`2.0.5`).

## 0.10.3

### Patch Changes

- 899ca18: Bump `@polkadot-apps/chain-client` to 2.0.5, which rotates the Paseo Asset Hub preset RPC list to live endpoints. Fixes `dot init` hanging on the funding step with repeated "Unable to connect to …" errors when both previously-configured endpoints (Dwellir, `sys.ibp.network`) were simultaneously unhealthy.

## 0.10.2

### Patch Changes

- b854eae: Upgrade `bulletin-deploy` pin to `0.7.2`. Fewer spurious upload failures now that the default chunk timeout covers Bulletin's 24s Aura slots, and a Bun-safe memory-report teardown upstream. No API changes on our side.

## 0.10.1

### Patch Changes

- f39d0aa: `dot init` now falls back to a dedicated testnet funder account if Alice is drained on Paseo Asset Hub — so new users aren't blocked the moment someone drains Alice. If both funders are low, the UI points users at `https://faucet.polkadot.io/` prefilled with their own address so they can self-fund and move on. `dot deploy --signer dev` gets the same fallback and, on exhaustion, guides the user to switch to the mobile signer instead. Adds a scheduled GitHub Actions workflow that files an issue when the dedicated funder needs topping up.

## 0.10.0

### Minor Changes

- c6cdc06: Add optional contract deploy step to `dot deploy`. When the project root contains a `foundry.toml`, a `hardhat.config.*`, or a `Cargo.toml` with a `pvm_contract` dep, the TUI now asks "deploy contracts?" (default no), and `dot deploy --contracts` runs it non-interactively. All three paths compile locally (foundry via `forge build --resolc`, hardhat via `npx hardhat compile`, cdm via `@dotdm/contracts`) and then hand the PolkaVM bytecode to cdm's `ContractDeployer.deployBatch`, which weight-aware-chunks the deploys into `Utility.batch_all` extrinsics. No constructor args, no contract registry publish, no on-chain metadata in this first cut — they'll land in a follow-up.

  Contract extrinsics are signed by a persistent on-disk **session key** at `~/.polkadot/accounts.json`, not the mobile signer — today's mobile flow can't handle the encoded size of a batched contract deploy, and the failure is miscategorised as a user-cancel. On first deploy the session key is funded by the user's main signer (one phone tap) or by Alice in pure dev mode; subsequent runs skip funding when the balance is already above the threshold.

  `dot init` gains a `foundry (polkadot)` dependency check that installs `foundryup-polkadot`.

## 0.9.1

### Patch Changes

- 73ad29b: Fix `dot deploy` crashing on Bun-compiled binaries with `node:v8 getHeapSpaceStatistics is not yet implemented in Bun.` when running from an internal Parity repo. Move the `bulletin-deploy` telemetry opt-out into a dedicated `src/bootstrap.ts` side-effect module imported before any other module, and additionally force `BULLETIN_DEPLOY_MEM_REPORT=0` so bulletin-deploy's diagnostic memory-report path can never reach Bun's unimplemented `v8.getHeapSpaceStatistics`. Explicit `BULLETIN_DEPLOY_TELEMETRY=1` / `BULLETIN_DEPLOY_MEM_REPORT=1` overrides are preserved.

## 0.9.0

### Minor Changes

- faae2ed: `dot deploy --playground` now inlines the project's `README.md` into the playground metadata so published apps show a rendered readme on their detail page. Readmes up to 20 KB are included automatically; if the file is larger the confirm screen shows a warning ("readme will not be uploaded") and the deploy proceeds without it. No action required — this works for any repo that already has a `README.md` at its root.

## 0.8.0

### Minor Changes

- e113540: `dot build` (and the build phase of `dot deploy`) now auto-installs the project's dependencies when `node_modules/` is missing. The package manager is inferred from the lockfile (`pnpm`/`yarn`/`bun`), falling back to `npm`. Previously, an uninstalled project fell through to `npx <framework> build`, which ephemerally downloaded the framework binary but then failed with a confusing `ERR_MODULE_NOT_FOUND` while loading the project's own config file (e.g. `vite.config.ts` importing `vite`).

## 0.7.2

### Patch Changes

- fdac80d: Bump `bulletin-deploy` pin from `0.6.16` to `0.7.0`. The only breaking change in 0.7.0 is the removal of the `--playground` CLI flag and the `playground?: boolean` `DeployOption`; playground-cli already owns registry publishing via its own `publishToPlayground()` flow, so this is a no-op for the deploy path.

## 0.7.1

### Patch Changes

- e77932d: Fix `dot deploy` reporting "already registered" on re-deploys made in dev mode when a phone session was also present.

  The domain-availability preflight was passing the logged-in user's SS58 address as the reference owner for the on-chain ownership check regardless of signer mode. In dev mode bulletin-deploy signs DotNS with its built-in `DEFAULT_MNEMONIC`, so the domain is owned by the dev account — not the user — and the preflight incorrectly reported the re-deploy as taken by a different account. We now only pass the user's address when `--signer phone` (where bulletin-deploy actually uses the user's signer). In dev mode we skip the ownership check and let bulletin-deploy's own preflight classify the re-deploy with the right signer.

## 0.7.0

### Minor Changes

- 4cdf839: `dot deploy` now asks whether to run the build step before deploying, defaulting to "yes" so the common case is still a single Enter press. Pass `--no-build` to skip the build non-interactively (useful when you've already built the project and just want to re-upload existing artifacts from `buildDir`). The confirm screen and headless summary both show whether the run will rebuild or reuse existing artifacts.

## 0.6.2

### Patch Changes

- c9c4bcd: Bump `bulletin-deploy` pin from 0.6.9 → 0.6.16.

  Picks up a fix for `merkleizeJS` (CIDs now preserve their codec so DAG-PB blocks are correctly indexed in the CAR body — the upstream bug our `jsMerkle` workaround was avoiding), on-chain verification after every DotNS `setContenthash`, clearer preflight messages on sanitized-to-Reserved labels, chain-time commit-age waits, and an idempotent pool `topUpBy`. No API changes required on our side.

## 0.6.1

### Patch Changes

- e27c1be: Suppress the cosmetic `UnsubscriptionError: Not connected` stack trace that appeared during `dot deploy`'s domain-availability check. It came from polkadot-api tearing down its chainHead follow subscription after `dotns.disconnect()` had already closed the WebSocket — expected, benign, and surfaced as either an `unhandledRejection` or `uncaughtException` depending on the runtime. The process now filters that specific rxjs error (UnsubscriptionError whose inner errors are all "Not connected") instead of logging a 40-line stack trace and tearing the deploy down. Unrelated rejections and exceptions still escalate as before; run with `DOT_DEPLOY_VERBOSE=1` to get a one-line note when a filter fires. Also adds a Troubleshooting section to the README pointing users at `DOT_MEMORY_TRACE=1` + `DOT_DEPLOY_VERBOSE=1` for memory / OOM bug reports.

## 0.6.0

### Minor Changes

- 440bd12: `dot mod` now prompts for the fork repository name after you pick (or pass) an app, with the previously random-suffixed default prefilled — press Enter to keep it, or type your own. The prompt is skipped with `--clone` (the target is only a local directory anyway), with `-y` / `--yes` (non-interactive default), or when you pass `--repo-name <name>` (which also doubles as the scripted override). Supplied names are validated against GitHub's repository-name rules and against existing directories on disk.

## 0.5.1

### Patch Changes

- 13a6c4e: Harden the deploy memory watchdog, add diagnostic logging for freezes / runaway RSS, and fix the phone-signer approval counter when a PoP upgrade is required.

  - **Watchdog now runs in a `worker_threads` Worker**, not a `setInterval` on the main thread. Under heavy microtask load (polkadot-api block subscriptions, bulletin-deploy retry loops) the main thread's macrotask queue can be starved for long enough that RSS climbs to 10+ GB between samples — at which point macOS jetsam delivers SIGKILL and the user sees a mystery `zsh: killed` with no guidance. The worker has its own event loop that can't be starved by the main thread, so the 4 GB cap now actually fires with a clear abort message. Sampling rate is also tightened from 5 s → 1 s now that it's off the hot path.
  - **New `DOT_DEPLOY_VERBOSE=1` env var** writes every bulletin-deploy log line (chunk progress, broadcast / included / finalized transitions, nonce traces, RPC reconnects) to stderr with a `[+<seconds>s]` timestamp. Previously the interceptor swallowed everything that wasn't a phase banner or `[N/M]` chunk line to keep the TUI clean; that made "deploy froze at chunk 2/6" reports diagnostically opaque. Pair with `DOT_MEMORY_TRACE=1` to correlate log events with RSS growth.
  - **Asset Hub client is now destroyed immediately after preflight** instead of lingering until deploy cleanup. Nothing in the deploy flow (build, bulletin-deploy's storage + DotNS, our playground publish) uses it between preflight and the publish step — and holding an idle polkadot-api client with a live best-block subscription for the full deploy window was measurable background pressure. Playground publish calls `getConnection()` which auto-re-establishes a fresh client at that point.
  - **Phone-signer approval count now matches reality.** For a PoP-gated name registered with a signer below the required tier, bulletin-deploy submits an extra `setUserPopStatus` tx before `register()` — so `dot deploy --signer phone --playground` actually fires 5 sigs, not 4. The summary card used to advertise "4 approvals" and the phone prompt later said "approve step 5 of 4". Fixed by predicting `needsPopUpgrade` during the availability check (via `getUserPopStatus` + mirrored `simulateUserStatus` logic) and threading that prediction into `resolveSignerSetup`, so the approvals list (and the derived summary, and the signing-proxy labels) are variable-length. Added: a belt-and-braces clamp in `createSigningCounter` that grows `total` when `step > total`, so even if our prediction mis-estimates for any reason the TUI never shows "step 5 of 4" again.
  - **Re-deploy path now shows a minimal phone tap count.** When the availability check reports the domain is already owned by the signer, bulletin-deploy skips `register()` entirely and only fires `setContenthash`. The summary card and counter now reflect that (1 DotNS tap instead of 3).

## 0.5.0

### Minor Changes

- a289cb9: New editorial TUI: every screen now renders through a single theme plug
  (`src/utils/ui/theme/`) — swap that folder to reskin the CLI, stub it to
  strip styling, zero styling leaks into commands.

  `dot init` now surfaces bulletin attestation status on every run — even
  for already-signed-in users — showing how long your upload quota is valid
  for in human-readable form (e.g. `~13d 4h · #14,582,331`), with warning
  color when expiry drops under 24 h.

  Bonus: the terminal tab title updates during long deploys, so
  `dot deploy` shows build / upload / publish / ✓ in your tab strip while
  you tab away to the browser.

## 0.4.1

### Patch Changes

- 8944350: Bump `bulletin-deploy` from `0.6.9-rc.6` to `0.6.9` (stable). Upstream changes:

  - **fix(dotns)** — Lite signers are now correctly rejected on `NoStatus` labels, matching the on-chain `PopRules` contract (upstream #101). Previously the check was missing the requirement clause and could let a Lite user through the classifier, only to have the register tx revert later.
  - **feat(dotns)** — bulletin-deploy now runs its own `DotNS.preflight(label)` before any Bulletin upload (upstream #102). Deploys that were going to fail DotNS registration (wrong label class, reserved base name, domain owned by someone else, unresolvable PoP gate) now abort with **zero Bulletin bytes paid**, saving users a failed multi-MB upload. A new public `DotNS.preflight()` view-only method and `simulateUserStatus()` / `popStatusName()` helpers are also exported.

  Our code surface (the `deploy()` entrypoint + `DotNS.connect` / `classifyName` / `checkOwnership` / `disconnect`) is unchanged, so the bump is drop-in. 147/147 tests pass.

## 0.4.0

### Minor Changes

- dede259: - New `dot build` command — auto-detects pnpm/yarn/bun/npm from the project's lockfile and runs the `build` script. Falls back to direct vite/next/tsc invocation when no build script is defined.
  - New interactive `dot deploy` flow. Prompts in order: signer (`dev` default / `phone`), build directory (default `dist/`), domain, and publish-to-playground (y/n). After inputs are chosen the TUI shows a dynamic summary card announcing exactly how many phone approvals will be requested and what each one is for.
  - Two signer modes for deploy:
    - `--signer dev` — `0` phone approvals if you don't publish to Playground, `1` if you do. Upload and DotNS are done with shared dev keys.
    - `--signer phone` — `3` approvals (DotNS commitment, finalize, setContenthash) + `1` for Playground publish if enabled.
  - Flags: `--signer`, `--domain`, `--buildDir`, `--playground`, `--suri`, `--env`. Passing all four of `--signer`, `--domain`, `--buildDir`, and `--playground` runs non-interactively.
  - Publishing to the Playground registry is always signed by the user, so the contract records their address as the app owner. This is what drives the playground-app "my apps" view.
  - Domain availability preflight — after you type a domain we hit DotNS's `classifyName` + `checkOwnership` (view calls, no phone taps) so names reserved for governance or already registered by a different account are caught BEFORE we build and upload. Headless mode fails fast with the reason; interactive mode shows the reason inline and lets you type a different name without restarting.
  - Re-deploying the same domain now works. The availability check used to fall back to bulletin-deploy's default dev mnemonic for the ownership comparison, so a domain owned by the user's own phone signer came back as `taken` — blocking every legitimate content update. The caller now passes their SS58 address, we derive the H160 via `@polkadot-apps/address::ss58ToH160`, and `checkOwnership(label, userH160)` returns `owned: true` when the user is the owner → we surface it as an `available` with the note "Already owned by you — will update the existing deployment.".
  - All chain URLs, contract addresses, and the `testnet`/`mainnet` switch consolidated into a single `src/config.ts`.
  - Deploy SDK is importable from `src/utils/deploy` without pulling in React/Ink so WebContainer consumers (RevX) can drive their own UI off the same event stream.
  - Workaround for Bun compiled-binary TTY stdin bug that prevented `useInput`-driven TUIs from receiving keystrokes or Ctrl+C. A no-op `readable` listener is attached at CLI entry as a warm-up.
  - Bumped `bulletin-deploy` from 0.6.7 to 0.6.9-rc.4. Fixes `WS halt (3)` during chunk upload (heartbeat bumped from 40s to 300s to exceed the 60s chunk timeout) and eliminates nonce-hopping on retries that used to duplicate chunk storage and trigger txpool readiness timeouts. Pin is deliberately on the RC tag — the `latest` npm tag still points at the broken 0.6.8.
  - Fixed runaway memory use (observed 20+ GB) during long deploys. The TUI was calling `setState` on every build-log and bulletin-deploy console line; verbose frameworks and retry storms produced enough React update backpressure to balloon the process. Info updates are now coalesced to ≤10/sec and capped at 160 chars.
  - Fixed `Contract execution would revert` failure in the Playground publish step. The metadata-JSON upload was routed through `bulletin-deploy.deploy()`, which unconditionally runs a second DotNS `register()` + `setContenthash()` on a randomly generated `test-domain-<id>` label — that's what was reverting. We now upload the metadata via `@polkadot-apps/bulletin::upload()` (pure `TransactionStorage.store`, no DotNS) and only invoke DotNS for the user's real domain. The user's phone signer is now correctly driven when `registry.publish()` fires, so the "Check your phone" panel appears as expected.
  - Fixed `WS halt (3)` recurrence after switching the metadata upload to `@polkadot-apps/bulletin`. That path went through the shared `@polkadot-apps/chain-client` Bulletin WS, which uses polkadot-api's 40 s default heartbeat — shorter than a single `TransactionStorage.store` submission. The upload now uses a dedicated Bulletin client built with `heartbeatTimeout: 300 s` and destroyed immediately after (same value `bulletin-deploy` uses for its own clients).
  - Added a multi-layer process-guard (`src/utils/process-guard.ts`) to eliminate zombie `dot` processes that had been observed accumulating to 25+ GB of RSS and triggering OS swap-death. (1) SIGINT/SIGTERM/SIGHUP and `unhandledRejection` all run cleanup hooks and force-exit within 3 s; (2) after the deploy's main flow returns, an `unref`'d hard-exit timer kills the process if a leaked WebSocket keeps the event loop alive past a grace period; (3) a 4 GB absolute RSS watchdog aborts the deploy before the machine swaps to death; (4) `BULLETIN_DEPLOY_TELEMETRY` is defaulted to `"0"` so Sentry can no longer buffer breadcrumbs; (5) the stdin warmup listener is `unref`'d so it doesn't hold the loop open on exit. Set `DOT_MEMORY_TRACE=1` to stream per-sample memory stats (RSS / heap / external) when diagnosing a real leak.
  - Bumped `bulletin-deploy` from 0.6.9-rc.4 to 0.6.9-rc.6 (picks up DotNS commit-reveal + commitment-age fixes).
  - Cut the log-event firehose: `DeployLogParser` now only emits events for phase banners and `[N/M]` chunk progress — NOT for every info prose line bulletin-deploy prints. Previously every line allocated an event object + traversed the orchestrator→TUI pipeline, compounding heap pressure during long chunk uploads.
  - Fixed deployed sites returning `{"message":"404: Not found"}` in Polkadot Desktop. Bulletin-deploy's pure-JS merkleizer (`jsMerkle: true` path) produces CARs containing only the raw leaf blocks — the DAG-PB directory/file structural nodes are silently dropped by `blockstore-core/memory`'s `getAll()` iterator. Desktop fetches the CAR, sees the declared root CID, finds no block for it in the CAR, parses zero files, renders 404. We now leave `jsMerkle` off so bulletin-deploy uses the Kubo binary path (`ipfs add -r ...`) which produces a complete, parseable CAR. `dot init` installs `ipfs`, so this works out of the box. Note: this temporarily regresses the RevX WebContainer story for the main storage upload — we'll flip `jsMerkle: true` back on once the upstream merkleizer is fixed to collect all blocks, not just leaves.

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
