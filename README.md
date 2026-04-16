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

### `dot deploy` (stub)

Will build and publish an app + its contracts. Currently accepts and prints its flags:

- `--contracts` — include contract build & deploy
- `--skip-frontend` — skip frontend build & deploy
- `--domain <name>` — DNS name override (else read from `package.json`)
- `--playground` — publish to the playground registry
- `--env <env>` — `testnet` (default) or `mainnet`
- `-y, --yes` — skip interactive prompts

### `dot mod` / `dot build` (stubs)

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

## Architecture Highlights

- **Signer shim** (`src/utils/signer.ts`) — the default session signer from `@polkadot-apps/terminal` uses `signRaw`, which the Polkadot mobile app wraps with `<Bytes>…</Bytes>` (producing a `BadProof` on-chain). We delegate to `getPolkadotSignerFromPjs` from `polkadot-api/pjs-signer`, which formats the payload as polkadot.js `SignerPayloadJSON` — exactly what the mobile's `SignPayloadJsonInteractor` consumes. This file can be removed once `@polkadot-apps/terminal` defaults to `signPayload`.
- **Connection singleton** (`src/utils/connection.ts`) — stores the promise (not the resolved client) so concurrent callers share a single WebSocket. Has a 30s timeout and preserves the underlying error via `Error.cause` for debugging.
- **Session lifecycle** (`src/utils/auth.ts`) — `getSessionSigner()` returns an explicit `destroy()` handle. Callers MUST call it (typically from a `useEffect` cleanup) — the host-papp adapter keeps the Node event loop alive.
