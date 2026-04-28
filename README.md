# playground-cli

CLI tooling for Polkadot Playground. Installed as the `dot` command.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | bash
```

To install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | VERSION=v0.2.0 bash
```

The installer drops the binary into `~/.polkadot/bin/`, symlinks it at `~/.local/bin/dot`, appends the path to your shell rc, and then runs `dot init` so you can finish setup without a second command.

## Commands

### `dot init`

End-to-end first-run setup. Login and toolchain install run **concurrently**; account setup runs **once both have completed successfully**.

1. **Login via the Polkadot mobile app** — a QR code is printed to the terminal. Scan it with the app. If you already have a session persisted in `~/.polkadot-apps/`, this step is skipped.
2. **Toolchain install** — `rustup`, nightly, `rust-src`, `cdm`, IPFS, and `gh`. Existing installs are detected and skipped.
3. **Account setup** (only if a session is available) — in order:
    - **Fund** — if your balance on Paseo Asset Hub is below 1 PAS, Alice sends 10 PAS (testnet).
    - **Map** — `Revive.map_account` is signed by you on the mobile app so an H160 is associated with your SS58 address.
    - **Allow** — Alice grants you 1000 transactions / 100 MB of Bulletin storage.

Flags:

- `-y, --yes` — skip the QR login entirely. Dependencies still install, account setup is skipped (no session).

### `dot update`

Self-update from the latest GitHub release. Detects your OS/arch, downloads the corresponding `dot-<os>-<arch>` asset, verifies HOME is set, and atomically replaces the running binary (write-to-staging-then-rename so the running process is never served a half-written file).

### `dot build`

Auto-detects the project's package manager (pnpm / yarn / bun / npm from the lockfile) and runs the `build` npm script. If no `build` script is defined, falls back to a framework invocation (`vite build`, `next build`, `tsc`) based on what's installed.

Flags:

- `--dir <path>` — project directory (defaults to the current working directory).

### `dot deploy`

Builds the project, uploads the output to Bulletin, registers a `.dot` domain via DotNS, and optionally publishes the app to the Playground registry (so it shows up in the user's "my apps" list).

Flags:

- `--signer <mode>` — `dev` (fast, uses shared dev keys for upload + DotNS — 0 or 1 phone approval) or `phone` (signs DotNS + publish with your logged-in account — 3 or 4 phone approvals). Interactive prompt if omitted.
- `--domain <name>` — DotNS label (with or without the `.dot` suffix). Interactive prompt if omitted.
- `--buildDir <path>` — directory holding the built artifacts (default `dist/`). Interactive prompt if omitted.
- `--playground` — publish to the playground registry so the app appears under "my apps". Interactive prompt (default: no) if omitted.
- `--modable` / `--no-modable` — publish the source repo URL alongside the deploy so others can `dot mod` it. Requires `--playground`. Interactive prompt (default: no) if omitted. When set, `dot deploy` ensures `git` and `gh` are installed (auto-installs if missing), confirms `gh` is authenticated (run `gh auth login` first if not — the deploy will fail with a hint otherwise), then either pushes `HEAD` to the existing `origin` or runs `gh repo create --public --push` to set one up. The resulting URL is recorded in the Bulletin metadata.
- `--repo-name <name>` — repo name to use when `--modable` needs to create a new GitHub repo (no existing `origin`). Defaults to the basename of the project directory; validated against GitHub's repository-name rules.
- `--suri <suri>` — override signer with a dev secret URI (e.g. `//Alice`). Useful for CI.
- `--env <env>` — `testnet` (default) or `mainnet` (not yet supported).

Passing all four of `--signer`, `--domain`, `--buildDir`, and `--playground` runs in fully non-interactive mode. Any absent flag is filled in by the TUI prompt. `--modable` is independently optional in both modes — its absence means a non-modable deploy.

**Requirement**: the `ipfs` CLI (Kubo) must be on `PATH`. `dot init` installs it; if you skipped init you can install it manually (`brew install ipfs` or follow [docs.ipfs.tech/install](https://docs.ipfs.tech/install/)). This is a temporary requirement while `bulletin-deploy`'s pure-JS merkleizer has a bug that makes the browser fallback unusable.

The publish step is always signed by the user so the registry contract records their address as the app owner — this is what drives the Playground "my apps" view.

### `dot mod`

Pull a modable playground app's source into a fresh local project so you can customise and re-deploy it. The interactive picker only shows apps that opted into modable at deploy time; non-modable apps surface a clear "this app is not modable" error if you target them by domain.

The implementation is GitHub-only and **requires no CLI tooling** — neither `git` nor `gh` is needed. Source is downloaded as a tarball over HTTPS from `codeload.github.com` (no auth needed for public repos), extracted into the target dir, then `git init`'d as a fresh history *if* `git` happens to be on `PATH`. With `git` absent, the directory still works — you just don't get version control until you install git yourself.

Flags:

- `[domain]` — positional; interactive picker over the registry if omitted. `.dot` suffix optional. The picker is filtered to modable apps only.
- `--suri <suri>` — dev signer secret URI (e.g. `//Alice`).

The local directory name is auto-generated as `<slug>-<6 hex chars>` so repeated mods of the same starter never collide (unlike GitHub forks, which were limited to one per account per repo).

## Troubleshooting

### Telemetry

Telemetry is off by default for unknown external users. It is enabled automatically in known internal Parity contexts and can be controlled explicitly:

- `DOT_TELEMETRY=1` opts in.
- `DOT_TELEMETRY=0` opts out.
- `DOT_TAG=e2e-local-smoke` marks a synthetic run; use the same `e2e-*`, `load-*`, or `canary-*` naming families for other synthetic traffic.
- `SENTRY_DSN` overrides the bundled Sentry DSN for local testing.

Telemetry scrubs local home-directory paths and avoids sending raw command arguments.

### Reporting a memory issue

If `dot deploy` gets killed with `✖ Memory use exceeded 4 GB` (the watchdog's abort) or you see RSS climb unexpectedly, re-run with both of:

```bash
DOT_MEMORY_TRACE=1 DOT_DEPLOY_VERBOSE=1 dot deploy ...
```

- `DOT_MEMORY_TRACE=1` streams a per-second `rss / heap / external / peak` sample to stderr from the watchdog worker. The worker has its own event loop, so samples keep firing even while the main thread is busy — perfect for capturing the timeline of a leak.
- `DOT_DEPLOY_VERBOSE=1` prefixes every `bulletin-deploy` log line with `[+<seconds>s]` so you can line the memory samples up with the exact chunk / retry / reconnect that preceded each spike.

Attach the combined output to the bug report along with the site size and roughly how many chunks the deploy was into when the spike started — it's dramatically more useful than a stack trace alone.

## Contributing

### Setup

```bash
pnpm install
pnpm build
```

### Local Install

Compile and install the `dot` binary to `~/.polkadot/bin/`:

```bash
pnpm cli:install
```

### Tests

```bash
pnpm test            # one-shot
pnpm test:watch      # rerun on change
npx tsc --noEmit     # type check
```

Tests live alongside the code as `*.test.ts`. They avoid mocking so deeply that they just re-implement the code under test — real `polkadot-api` primitives (`Enum`) stay real so a variant name change is caught.

### Testing a Branch Build

Every PR automatically publishes a dev release tagged with the branch name. Others can try it with:

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | VERSION=dev/my-branch bash
```

### Releasing

Releases are triggered by [changesets](https://github.com/changesets/changesets). To cut a release:

1. Create a changeset: `pnpm changeset`
2. Commit the generated `.changeset/*.md` file with your PR
3. On merge to `main`, CI consumes the changeset, bumps the version, compiles binaries, and creates a GitHub release

### Formatting

Uses [Biome](https://biomejs.dev/). Checked in CI on every PR.

```bash
pnpm format        # fix
pnpm format:check  # check only
```

## Dependency Notes

- `@polkadot-apps/*` are pinned to `latest` intentionally — they are our own packages and we want the lockfile to track head.
- `@polkadot-api/sdk-ink` is pinned to `^0.6.2` and `polkadot-api` to `^1.23.3` because `chain-client` currently embeds an internal `PolkadotClient` shape that breaks with newer versions. Bump together with `chain-client` only.
- `bulletin-deploy` is pinned to an explicit version — not `latest`. Currently `0.7.6`. Previously `latest` pointed at 0.6.8 which had a WebSocket heartbeat bug (40s default < 60s chunk timeout) that tore chunk uploads down as `WS halt (3)`; keeping the pin explicit avoids ever sliding back onto that. When bumping, check the release notes for any changes to `deploy()` / `DotNS` APIs we rely on.

## Architecture Highlights

- **Single config module** (`src/config.ts`) — all chain URLs, contract addresses, dapp identifiers and the `testnet`/`mainnet` switch live here. Nothing else in the tree should hard-code an endpoint or address.
- **Signer shim** (`src/utils/session-signer-patch.ts`) — the default session signer from `@polkadot-apps/terminal` uses `signRaw`, which the Polkadot mobile app wraps with `<Bytes>…</Bytes>` (producing a `BadProof` on-chain). We delegate to `getPolkadotSignerFromPjs` from `polkadot-api/pjs-signer`, which formats the payload as polkadot.js `SignerPayloadJSON` — exactly what the mobile's `SignPayloadJsonInteractor` consumes. This file can be removed once `@polkadot-apps/terminal` defaults to `signPayload`.
- **Unified signer resolution** (`src/utils/signer.ts`) — one `resolveSigner({ suri? })` call returns a `ResolvedSigner` whether the user is authenticated via QR session or a dev `//Alice`-style URI. Every command threads the result through to its operations instead of branching on source.
- **Connection singleton** (`src/utils/connection.ts`) — stores the promise (not the resolved client) so concurrent callers share a single WebSocket. Has a 30s timeout and preserves the underlying error via `Error.cause` for debugging.
- **Session lifecycle** (`src/utils/auth.ts`) — `getSessionSigner()` returns an explicit `destroy()` handle. Callers MUST call it (typically from a `useEffect` cleanup) — the host-papp adapter keeps the Node event loop alive.
- **Deploy SDK / CLI split** (`src/utils/deploy/` + `src/commands/deploy/`) — the CLI command is a thin Commander + Ink wrapper around a pure `runDeploy()` orchestrator. The orchestrator avoids React/Ink so WebContainer consumers (e.g. RevX) can drive their own UI off the same event stream.
- **Signer-mode isolation** (`src/utils/deploy/signerMode.ts`) — decides which signer each deploy phase uses (pool mnemonic vs user's phone) in one place so the mainnet rewrite can be a single-file swap.
- **Bulletin delegation** — all storage-side hardening (pool management, chunk retry, nonce fallback, DAG-PB verification, DotNS commit-reveal) stays inside `bulletin-deploy`. We call `deploy(..., { jsMerkle: true })` so the flow stays binary-free and runs unchanged in a WebContainer.
- **Signing proxy** (`src/utils/deploy/signingProxy.ts`) — wraps the user's `PolkadotSigner` to emit `sign-request`/`-complete`/`-error` lifecycle events. The TUI renders these as "📱 Check your phone" panels with live step counts.
- **Playground publish is ours** (`src/utils/deploy/playground.ts`) — we deliberately do NOT use `bulletin-deploy`'s `--playground` flag. We call the registry contract from `src/utils/registry.ts` with the user's signer so the contract records their `env::caller()` as the owner — required for the Playground app's "my apps" view.
