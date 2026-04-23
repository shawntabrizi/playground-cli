# playground-cli

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
