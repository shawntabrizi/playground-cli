# playground-cli

CLI tooling for Polkadot Playground. Installed as the `playground` command, with `pg` as a short alias — both invoke the same binary, so `playground init` and `pg init` are interchangeable.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | bash
```

To install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/playground-cli/main/install.sh | VERSION=v0.2.0 bash
```

The installer drops the binary into `~/.polkadot/bin/playground`, symlinks both `playground` and the short `pg` alias into `~/.local/bin/`, appends the path to your shell rc, and then runs `playground init` so you can finish setup without a second command.

## Commands

### `playground init`

End-to-end first-run setup. Login and toolchain install run **concurrently**; account setup runs **once both have completed successfully**.

1. **Login via the Polkadot mobile app** — a QR code is printed to the terminal. Scan it with the app. If you already have a session persisted in `~/.polkadot-apps/`, this step is skipped.
2. **Toolchain install** — `rustup`, nightly, `rust-src`, `cargo-pvm-contract`, IPFS, and `git`. Existing installs are detected and skipped.
3. **Account setup** (only if a session is available) — in order:
    - **Fund** — if your balance on Paseo Asset Hub is below 1 PAS, Alice sends 10 PAS (testnet).
    - **Map** — `Revive.map_account` is signed by you on the mobile app so an H160 is associated with your SS58 address.
    - **Allow** — Alice grants you 1000 transactions / 100 MB of Bulletin storage.

Flags:

- `-y, --yes` — skip the QR login entirely. Dependencies still install, account setup is skipped (no session).

### `playground update`

Self-update from the latest GitHub release. Detects your OS/arch, downloads the corresponding `dot-<os>-<arch>` asset, verifies HOME is set, and atomically replaces the running binary (write-to-staging-then-rename so the running process is never served a half-written file).

### `playground build`

Auto-detects the project's package manager (pnpm / yarn / bun / npm from the lockfile) and runs the `build` npm script. If no `build` script is defined, falls back to a framework invocation (`vite build`, `next build`, `tsc`) based on what's installed.

Flags:

- `--dir <path>` — project directory (defaults to the current working directory).

### `playground deploy`

Builds the project, uploads the output to Bulletin, registers a `.dot` domain via DotNS, and optionally publishes the app to the Playground registry (so it shows up in the user's "my apps" list).

Flags:

- `--signer <mode>` — `dev` (fast, uses shared dev keys for upload + DotNS — 0 or 1 phone approval) or `phone` (signs DotNS + publish with your logged-in account — 3 or 4 phone approvals). Interactive prompt if omitted.
- `--domain <name>` — DotNS label (with or without the `.dot` suffix). Interactive prompt if omitted.
- `--buildDir <path>` — directory holding the built artifacts (default `dist/`). Interactive prompt if omitted.
- `--no-build` — skip the frontend build step and deploy whatever is already in `--buildDir`.
- `--playground` — publish to the playground registry so the app appears under "my apps". Interactive prompt (default: no) if omitted.
- `--private` — publish to the playground with private (owner-only) visibility. Requires `--playground`. Not interactively prompted; pass the flag to opt in.
- `--moddable` / `--no-moddable` — publish the source repo URL alongside the deploy so others can `playground mod` it. Requires `--playground`. Interactive prompt (default: no) if omitted. The CLI reads your existing `origin` and records its URL in the Bulletin metadata; it never creates a repo or pushes for you. The deploy fails with an actionable message if `origin` is unset, points to a private repo, or points to anything other than GitHub (since `playground mod` only fetches from `codeload.github.com`). Set up the repo yourself before re-running: create a public repo on GitHub, then `git remote add origin https://github.com/<user>/<repo>` followed by `git push -u origin main`. (If you happen to have `gh` installed, `gh repo create my-app --public --source=. --push` does both in one shot — `playground` does not require `gh`.)
- `--suri <suri>` — override signer with a dev secret URI (e.g. `//Alice`). Useful for CI.
- `--env <env>` — target environment. Defaults to `paseo-next-v2` (the only one fully wired today). Accepts the bulletin-deploy env IDs (`preview`, `paseo-next`, `paseo-review`, `paseo-next-v2`, `polkadot`, `kusama`) plus the legacy `testnet`/`mainnet` aliases — `testnet` maps to `paseo-next-v2`, `mainnet` to `polkadot`. Any env other than `paseo-next-v2` throws "not supported" until its entry is wired up in `src/config.ts::CONFIGS`.

Passing all four of `--signer`, `--domain`, `--buildDir`, and `--playground` runs in fully non-interactive mode. Any absent flag is filled in by the TUI prompt. `--moddable` and `--private` are independently optional in both modes — their absence means a non-moddable, public deploy.

**Requirement**: the `ipfs` CLI (Kubo) must be on `PATH`. `playground init` installs it; if you skipped init you can install it manually (`brew install ipfs` or follow [docs.ipfs.tech/install](https://docs.ipfs.tech/install/)). This is a temporary requirement while `bulletin-deploy`'s pure-JS merkleizer has a bug that makes the browser fallback unusable.

The publish step is always signed by the user so the registry contract records their address as the app owner — this is what drives the Playground "my apps" view.

#### CI / automation usage

For fully non-interactive (CI) runs, combine `--signer`, `--domain`, `--buildDir`, and `--playground` to skip every TUI prompt. Layer the optional flags on top:

- `--suri //Alice` — required with `--signer dev` so the dev signer has a known keypair (works with any dev name or full BIP-39 mnemonic).
- `--no-build` — reuse pre-built frontend assets in `--buildDir`.
- `--no-moddable` — explicitly skip source publishing even if `--moddable` would otherwise apply.
- `--private` — publish to the playground with owner-only visibility.

### `playground contract`

CDM-backed workflows for contracts:

- `playground contract deploy` builds, deploys, and registers CDM contracts with playground's logged-in signer by default. Pass `--suri //Alice` for local/dev signing.
- `playground contract deploy --features <features>` forwards Cargo feature flags into CDM's build pipeline.
- `playground contract deploy --registry-address <address>` targets a specific CDM registry.
- `playground contract install [libraries...]` uses the CDM install backend with playground's native TUI, then writes `cdm.json` and CDM post-install outputs.

### `playground mod`

Pull a moddable playground app's source into a fresh local project so you can customise and re-deploy it. The interactive picker only shows apps that opted into moddable at deploy time; non-moddable apps surface a clear "this app is not moddable" error if you target them by domain.

The implementation is GitHub-only and **requires no CLI tooling** — neither `git` nor `gh` is needed. Source is downloaded as a tarball over HTTPS from `codeload.github.com` (no auth needed for public repos), extracted into the target dir, then `git init`'d as a fresh empty history *if* `git` happens to be on `PATH`. No baseline commit is created, so you can stage and commit your first revision however you like. With `git` absent, the directory still works — you just don't get version control until you install git yourself.

Flags:

- `[domain]` — positional; interactive picker over the registry if omitted. `.dot` suffix optional. The picker is filtered to moddable apps only.
- `--suri <suri>` — dev signer secret URI (e.g. `//Alice`).

The local directory name is auto-generated as `<slug>-<6 hex chars>` so repeated mods of the same starter never collide (unlike GitHub forks, which were limited to one per account per repo).

### `playground logout`

Sign out of the account paired via `playground init`. Sends a `Disconnected` statement so the paired Polkadot mobile app drops its side of the connection, then clears the local session files under `~/.polkadot-apps/`. If the remote notification fails (statement store unreachable, …), the local files are still cleared and the command surfaces a `partial` status — the mobile app will show a stale pairing until it reconnects. No-op when no session is signed in.

## Troubleshooting

### Telemetry

Telemetry is off by default for unknown external users. It is enabled automatically in known internal Parity contexts and can be controlled explicitly:

- `DOT_TELEMETRY=1` opts in.
- `DOT_TELEMETRY=0` opts out.
- `DOT_TAG=e2e-local-smoke` marks a synthetic run; use the same `e2e-*`, `load-*`, or `canary-*` naming families for other synthetic traffic.
- `SENTRY_DSN` overrides the bundled Sentry DSN for local testing.

Telemetry scrubs local home-directory paths and avoids sending raw command arguments.

### Reporting a memory issue

If `playground deploy` gets killed with `✖ Memory use exceeded 4 GB` (the watchdog's abort) or you see RSS climb unexpectedly, re-run with both of:

```bash
DOT_MEMORY_TRACE=1 DOT_DEPLOY_VERBOSE=1 playground deploy ...
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

Compile and install the `playground` binary (plus the `pg` alias) to `~/.polkadot/bin/`:

```bash
pnpm cli:install
```

### Tests

```bash
pnpm test            # unit tests, one-shot
pnpm test:watch      # rerun on change
npx tsc --noEmit     # type check

pnpm test:e2e        # E2E tests (slow; run `playground init` first)
```

#### Unit tests

Live alongside the code as `*.test.ts`. They avoid mocking so deeply that they just re-implement the code under test — real `polkadot-api` primitives (`Enum`) stay real so a variant name change is caught.

#### E2E tests

Live under `e2e/cli/*.test.ts`, with a separate `e2e/vitest.config.ts`. Each test spawns the CLI via `bun run src/index.ts` (execa wrapper in `e2e/cli/helpers/dot.ts`) and asserts on stdout/stderr/exit code. Files run serially — they share a single deployer account on Paseo and would race otherwise.

Prerequisite: run `playground init` once to install the required local deps (mainly Kubo IPFS for the deploy pipeline). Tests also reach Paseo Asset Hub and `codeload.github.com` over the internet, so they need network.

CI runs the suite on every PR, on push to `main`, and daily at 06:00 UTC (`.github/workflows/e2e.yml`).

Running a single file: invoke vitest directly to avoid a `pnpm`/`vitest` `--`-forwarding gotcha that runs the whole suite anyway:

```bash
pnpm vitest run --config e2e/vitest.config.ts e2e/cli/session.test.ts
```

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

### License Headers

Every tracked `.ts` / `.tsx` / `.rs` file must carry the Parity-style Apache-2.0 SPDX header. CI's `License Headers` workflow runs `scripts/check-license-headers.sh` on every PR.

```bash
pnpm lint:license                       # check
./scripts/check-license-headers.sh --fix  # prepend the header to any missing files
```

### Verification before committing

Run all of these locally before opening a PR (and before declaring work complete from an AI agent session):

```bash
pnpm format:check
pnpm lint:license
pnpm test
```

The first two are also enforced in CI; running them locally catches the failure before the PR turns red. `pnpm build` is the canonical type signal — there is no separate `tsc` step.

## Dependency Notes

- `@parity/product-sdk-*` packages use caret ranges (`^0.x.y`) so upstream patch and minor releases auto-resolve on a fresh `pnpm install`. With pre-1.0 versions, `^` only widens patches within the current 0.x line — a 0.x → 0.(x+1) bump still requires an intentional `package.json` change. CI's `Format` job runs a grep guard that fails the build on any direct `@polkadot-apps/*` import in `src/`, `e2e/`, `scripts/`, or `tools/`.
- `@dotdm/contracts` is on the `^3.x` caret. The legacy `1.1.1` stable still pulls `@polkadot-apps/*` + `polkadot-api@1.x` and must NOT be downgraded to.
- `@novasamatech/*` packages are forced to `0.7.9-4` via `pnpm.overrides`. They come in transitively from `@parity/product-sdk-terminal` whose `^0.7.7` caret doesn't auto-widen across patches in lockfile updates; the override aligns the tree on the latest published Novasama line (including RFC-0010 `requestResourceAllocation` on `UserSession`). Drop the override once product-sdk-terminal widens its own caret.
- `polkadot-api` is on `^2.1.x` and `@polkadot-api/sdk-ink` on `^0.7.0`. The lockfile contains a stale `polkadot-api@1.x` only because `@parity/dotns-cli`'s declared dep references it; that CLI ships as a single bundled `dist/cli.js` with all deps inlined, so the 1.x decl is never resolved at runtime. Effectively the runtime is PAPI 2.x-only.
- `bulletin-deploy` is pinned to an explicit version — not `latest`. Currently `0.7.24`. Previously `latest` pointed at 0.6.8 which had a WebSocket heartbeat bug (40s default < 60s chunk timeout) that tore chunk uploads down as `WS halt (3)`; keeping the pin explicit avoids ever sliding back onto that. When bumping, check the release notes for any changes to `deploy()` / `DotNS` APIs we rely on (`jsMerkle`, `signer`, `signerAddress`, `mnemonic`, `rpc`, `attributes`).
- `pnpm.overrides` also redirects `@parity/dotns-cli`'s declared `@polkadot-api/descriptors` dep to `stubs/papi-descriptors-stub/`. `@parity/dotns-cli@0.6.1`'s published manifest references a workspace path (`file:.papi/descriptors`) that doesn't exist in the tarball; pnpm refuses, npm tolerates it. dotns-cli ships as a fully-bundled `dist/cli.js` so the stub (exporting `{}`) is functionally correct. Remove once `@parity/dotns-cli` republishes a clean manifest.

## Architecture Highlights

- **Single config module** (`src/config.ts`) — all chain URLs, contract addresses, dapp identifiers and the `testnet`/`mainnet` switch live here. Nothing else in the tree should hard-code an endpoint or address.
- **QR-paired session signer** (`src/utils/auth.ts::createPlaygroundSigner`) — wraps `@parity/product-sdk-terminal@0.2.1+`'s `createSessionSignerForAccount`, a PAPI-native signer that routes extrinsic payloads through `session.signRaw({ data: { tag: "Payload", value: hex(toSign) } })` (opaque bytes, no `<Bytes>` envelope) so every signed extension declared by the chain — including paseo-next-v2's `AsPgas` — survives end-to-end. The product account derives from `productId="playground.dot"` + `derivationIndex=0`, which matches what the playground-app uses on the host side so the same address signs in both surfaces.
- **Unified signer resolution** (`src/utils/signer.ts`) — one `resolveSigner({ suri? })` call returns a `ResolvedSigner` whether the user is authenticated via QR session or a dev `//Alice`-style URI. Every command threads the result through to its operations instead of branching on source.
- **Connection singleton** (`src/utils/connection.ts`) — stores the promise (not the resolved client) so concurrent callers share a single WebSocket. Has a 30s timeout and preserves the underlying error via `Error.cause` for debugging.
- **Session lifecycle** (`src/utils/auth.ts`) — `getSessionSigner()` returns an explicit `destroy()` handle. Callers MUST call it (typically from a `useEffect` cleanup) — the host-papp adapter keeps the Node event loop alive.
- **Deploy SDK / CLI split** (`src/utils/deploy/` + `src/commands/deploy/`) — the CLI command is a thin Commander + Ink wrapper around a pure `runDeploy()` orchestrator. The orchestrator avoids React/Ink so WebContainer consumers (e.g. RevX) can drive their own UI off the same event stream.
- **Signer-mode isolation** (`src/utils/deploy/signerMode.ts`) — decides which signer each deploy phase uses (pool mnemonic vs user's phone) in one place so the mainnet rewrite can be a single-file swap.
- **Bulletin delegation** — all storage-side hardening (pool management, chunk retry, nonce fallback, DAG-PB verification, DotNS commit-reveal) stays inside `bulletin-deploy`. We call `deploy(..., { jsMerkle: true })` so the flow stays binary-free and runs unchanged in a WebContainer.
- **Signing proxy** (`src/utils/deploy/signingProxy.ts`) — wraps the user's `PolkadotSigner` to emit `sign-request`/`-complete`/`-error` lifecycle events. The TUI renders these as "📱 Check your phone" panels with live step counts.
- **Playground publish is ours** (`src/utils/deploy/playground.ts`) — we deliberately do NOT use `bulletin-deploy`'s `--playground` flag. We call the registry contract from `src/utils/registry.ts` with the user's signer so the contract records their `env::caller()` as the owner — required for the Playground app's "my apps" view.
