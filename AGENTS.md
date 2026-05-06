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
- Install local binary: `pnpm cli:install`

## Repository Conventions

- Tests live next to the source as `*.test.ts`. `vitest.config.ts` only picks up `.test.ts`; update it before adding `.tsx` tests.
- Pure logic embedded in `.tsx` components should be lifted into sibling `.ts` files so tests can import it without pulling React and Ink into the runner.
- Every user-facing PR needs a changeset in `.changeset/*.md`. Refactors, tests, and internal tooling-only changes can skip one.
- Do not add AI/tool attribution, signatures, or provenance to commits, PRs, generated files, or repo content.
- Do not commit design docs, brainstorming notes, context dumps, or scratch files.
- Do not mock `polkadot-api` primitives such as `Enum` or encoders in tests.
- Long-lived resources such as `TerminalAdapter`, session signers, and chain clients must be explicitly destroyed in cleanups.

## Dependency Rules

- Do not upgrade `polkadot-api` or `@polkadot-api/sdk-ink` past the current pins unless `@polkadot-apps/chain-client` is bumped and compatibility is verified.
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
- Do not call `bulletin-deploy.deploy()` just to store playground metadata JSON. Use `@polkadot-apps/bulletin::upload()` so it submits `TransactionStorage.store` directly and returns the CID.
- Metadata uploads need a dedicated Bulletin client with `heartbeatTimeout: 300_000`, destroyed immediately after upload.
- `dot deploy` currently relies on the Kubo binary path and must not pass `jsMerkle: true` until bulletin-deploy's pure-JS merkleizer preserves DAG-PB directory/file blocks correctly.
- `dot init` installs `ipfs`, so deploys can rely on the Kubo CLI after setup.

## Runtime Safety

- `getSessionSigner()` returns an adapter that keeps the Node event loop alive. Every caller must call the returned `destroy()`.
- New long-running commands should register cleanup through `onProcessShutdown()` and use the process guard where appropriate.
- `startMemoryWatchdog()` runs for both `dot deploy` and `dot mod`; add it to new top-level commands that do meaningful I/O.
- TUI info updates must be throttled or coalesced. Do not stream raw high-volume logs directly into Ink state.
- `DeployLogParser.feed()` must not emit catch-all events per log line. Keep events limited to meaningful phase/progress matches.

## Mod And GitHub Behavior

- `dot mod` is GitHub-tarball-only. Do not reintroduce `git clone`, `gh repo fork`, or tooling requirements for the public-repo path.
- `dot` never invokes `gh`. `dot deploy --modable` reads an existing `origin` and validates it's a public GitHub URL via `HEAD https://github.com/{o}/{r}`; missing `origin`, private repos, and non-GitHub URLs hard-fail with actionable messages from `src/utils/deploy/modable.ts`. Do not reintroduce auto-create, `gh auth` checks, or any `gh`-shell-out path — the user is responsible for setting up the public GitHub repo themselves.
- `metadata.repository` is written only when `--modable` is explicitly opted in.

## Sentry Telemetry

- Helpers in `src/telemetry.ts`, `src/utils/deploy/phase.ts`, `src/cli-runtime.ts`. Every command wraps with `runCliCommand`; every deploy phase wraps with `withDeployPhase`. Don't reimplement the boilerplate.
- Dashboards are JSON snapshots in `sentry/dashboards/`. Run `./sentry/backup-dashboards.sh` before any change. Use `./sentry/patch-dashboard.py` and `./sentry/create-dashboard.py` for edits and new dashboards.
- E2E test runs are tagged `cli.tag:e2e-ci` (CI) or `cli.tag:e2e-local` (helper default). Production widgets exclude `cli.tag:e2e-*`; the E2E Health dashboard (id 2216096) targets it.
