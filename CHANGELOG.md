# playground-cli

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
