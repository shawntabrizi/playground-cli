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
- `--suri <suri>` — override signer with a dev secret URI (e.g. `//Alice`). Useful for CI.
- `--env <env>` — `testnet` (default) or `mainnet` (not yet supported).

Passing all four of `--signer`, `--domain`, `--buildDir`, and `--playground` runs in fully non-interactive mode. Any absent flag is filled in by the TUI prompt.

**Requirement**: the `ipfs` CLI (Kubo) must be on `PATH`. `dot init` installs it; if you skipped init you can install it manually (`brew install ipfs` or follow [docs.ipfs.tech/install](https://docs.ipfs.tech/install/)). This is a temporary requirement while `bulletin-deploy`'s pure-JS merkleizer has a bug that makes the browser fallback unusable.

The publish step is always signed by the user so the registry contract records their address as the app owner — this is what drives the Playground "my apps" view.

### `dot mod` (stub)

Planned. No behaviour yet.

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
- `bulletin-deploy` is pinned to an explicit `0.6.9-rc.N` — not `latest`. The `latest` npm dist-tag still points at 0.6.8, which has a WebSocket heartbeat bug (40s default < 60s chunk timeout) that tears down chunk uploads as `WS halt (3)`. Move to 0.6.9 once it ships stable; until then bump the RC pin (published under the `rc` npm dist-tag) to pick up further fixes.

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
