# AGENTS.md

## Project Overview

`playground-cli` is a TypeScript ESM CLI for Polkadot Playground, installed as the `dot` command. The CLI uses Commander and Ink/React for terminal UI, is compiled with Bun, and is tested with Vitest.

Read `CLAUDE.md` alongside this file when you need the full rationale for repo-specific invariants.

## Commands

- Install dependencies: `pnpm install`
- Build compiled CLI: `pnpm build`
- Run tests: `pnpm test`
- Watch tests: `pnpm test:watch`
- Type check: `npx tsc --noEmit`
- Format: `pnpm format`
- Check formatting: `pnpm format:check`
- Check license headers: `pnpm lint:license`
- Install local binary: `pnpm cli:install`

## Verification before committing

Run all of these before claiming work is done, opening a PR, or merging. The first two are enforced by CI; the third catches regressions a typecheck would not.

```bash
pnpm format:check
pnpm lint:license
pnpm test
```

`pnpm build` is the canonical type signal (no separate `tsc` step). If `lint:license` fails on a file you wrote, run `./scripts/check-license-headers.sh --fix` to prepend the header — every tracked `.ts` / `.tsx` / `.rs` file must carry the full Parity-style Apache-2.0 block (SPDX line + Parity copyright line both required).

## Repository Conventions

- Tests live next to the source as `*.test.ts`. `vitest.config.ts` only picks up `.test.ts`; update it before adding `.tsx` tests.
- Pure logic embedded in `.tsx` components should be lifted into sibling `.ts` files so tests can import it without pulling React and Ink into the runner.
- Every user-facing PR needs a changeset in `.changeset/*.md`. Refactors, tests, and internal tooling-only changes can skip one.
- Do not add AI/tool attribution, signatures, or provenance to commits, PRs, generated files, or repo content.
- Do not commit design docs, brainstorming notes, context dumps, or scratch files.
- Do not mock `polkadot-api` primitives such as `Enum` or encoders in tests.
- Long-lived resources such as `TerminalAdapter`, session signers, and chain clients must be explicitly destroyed in cleanups.

## Dependency Rules

- Direct imports come from `@parity/product-sdk-*`, not `@polkadot-apps/*`. `@polkadot-apps/*` is fully out of the lockfile (`@dotdm/contracts` ships its own product-sdk migration). CI's `Format` job greps `src/ e2e/ scripts/ tools/` for direct `@polkadot-apps/*` imports and fails the build on any match.
- `@dotdm/contracts` is pinned to the dev tag `1.1.1-dev.1778274929` until the maintainer promotes the migrated build to `latest`. The `1.1.1` stable still pulls `@polkadot-apps/*` + PAPI 1.x.
- `@novasamatech/*` is forced to `0.7.8-2` via `pnpm.overrides` because product-sdk-terminal's `^0.7.7` caret doesn't auto-widen across patches. Drop the override when upstream tightens the caret.
- `@parity/product-sdk-*` packages use caret ranges (`^0.x.y`) so upstream patch and minor releases land automatically on a fresh `pnpm install`.
- Keep `bulletin-deploy` pinned to an explicit version. Do not switch it to `latest`.
- When upgrading `bulletin-deploy`, check public API changes for `deploy()`, DotNS methods, `DeployOptions`, `jsMerkle`, signer options, RPC handling, and attributes.

## Architecture Boundaries

- All chain URLs and contract addresses belong in `src/config.ts`. Do not inline websocket URLs or `0x...` addresses elsewhere.
- Signer mode selection lives in `src/utils/deploy/signerMode.ts`; keep mainnet/testnet signer changes isolated there.
- `src/utils/deploy/*` and `src/utils/build/*` are SDK-facing surfaces for WebContainer consumers and must not import React or Ink.
- CLI/TUI code lives under `src/commands/*`.
- `src/bootstrap.ts` is the first import in `src/index.ts` and owns the ambient Sentry handoff to `bulletin-deploy`. Keep `DOT_TELEMETRY` as the privacy gate for both CLI telemetry and `BULLETIN_DEPLOY_TELEMETRY`.
- The Bun compiled-binary stdin warm-up in `src/index.ts` is intentional. Do not remove it until Bun compiled TTY stdin works reliably with Ink.

## Deploy And Storage Invariants

- Deploy delegates storage hardening to `bulletin-deploy`: chunking, retries, pool accounts, nonce fallback, DAG-PB, and DotNS commit-reveal stay there.
- The CLI owns `registry.publish()` because the registry contract must record the user as `env::caller()`.
- Do not call `bulletin-deploy.deploy()` just to store playground metadata JSON. Submit `TransactionStorage.store` directly via PAPI using `calculateCid` from `@parity/product-sdk-bulletin` (see `src/utils/deploy/playground.ts::publishToPlayground`). `deploy()` would also run a DotNS register/setContenthash pass on a random `test-domain-*` label, which reverts opaquely.
- Metadata uploads need a dedicated Bulletin client with `heartbeatTimeout: 300_000`, destroyed immediately after upload.
- `dot deploy` currently relies on the Kubo binary path and must not pass `jsMerkle: true` until bulletin-deploy's pure-JS merkleizer preserves DAG-PB directory/file blocks correctly.
- `dot init` installs `ipfs`, so deploys can rely on the Kubo CLI after setup.

## Runtime Safety

- The mobile app wraps `signRaw` data with `<Bytes>...</Bytes>` (anti-phishing envelope, still load-bearing on Android v1192). Tx-payload signing routed through `signRaw` produces a signature the chain rejects as `BadProof`. `@parity/product-sdk-terminal@0.2.0+`'s `createSessionSignerForAccount` handles this with split callbacks (tx → `signPayload`, bytes → `signRaw`); use it directly. Don't downgrade to `0.1.0` and don't hand-roll a `signRaw`-only signer for tx work.
- `getSessionSigner()` returns an adapter that keeps the Node event loop alive. Every caller must call the returned `destroy()`.
- New long-running commands should register cleanup through `onProcessShutdown()` and use the process guard where appropriate.
- `startMemoryWatchdog()` runs for both `dot deploy` and `dot mod`; add it to new top-level commands that do meaningful I/O.
- TUI info updates must be throttled or coalesced. Do not stream raw high-volume logs directly into Ink state.
- `DeployLogParser.feed()` must not emit catch-all events per log line. Keep events limited to meaningful phase/progress matches.

## Mod And GitHub Behavior

- `dot mod` is GitHub-tarball-only. Do not reintroduce `git clone`, `gh repo fork`, or tooling requirements for the public-repo path.
- `dot` never invokes `gh`. `dot deploy --moddable` reads an existing `origin` and validates it's a public GitHub URL via `HEAD https://github.com/{o}/{r}`; missing `origin`, private repos, and non-GitHub URLs hard-fail with actionable messages from `src/utils/deploy/moddable.ts`. Do not reintroduce auto-create, `gh auth` checks, or any `gh`-shell-out path — the user is responsible for setting up the public GitHub repo themselves.
- `metadata.repository` is written only when `--moddable` is explicitly opted in.

## Sentry Telemetry

- Helpers in `src/telemetry.ts`, `src/utils/deploy/phase.ts`, `src/cli-runtime.ts`. Every command wraps with `runCliCommand`; every deploy phase wraps with `withDeployPhase`. Don't reimplement the boilerplate.
- Dashboards are JSON snapshots in `sentry/dashboards/`. Run `./sentry/backup-dashboards.sh` before any change. Use `./sentry/patch-dashboard.py` and `./sentry/create-dashboard.py` for edits and new dashboards.
- E2E test runs are tagged `cli.tag:e2e-ci` (CI) or `cli.tag:e2e-local` (helper default). Production widgets exclude `cli.tag:e2e-*`; the E2E Health dashboard (id 2216096) targets it.
