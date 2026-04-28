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

- Tests live next to the source as `*.test.ts`.
- Every user-facing PR needs a changeset in `.changeset/*.md`.
- Do not add AI/tool attribution, signatures, or provenance to commits, PRs, generated files, or repo content.
- Do not commit design docs, brainstorming notes, context dumps, or scratch files.
- Do not mock `polkadot-api` primitives such as `Enum` or encoders in tests.
- Long-lived resources such as session signers and chain clients must be explicitly destroyed in cleanups.

## Architecture Boundaries

- All chain URLs and contract addresses belong in `src/config.ts`.
- `src/bootstrap.ts` is the first import and owns the ambient Sentry handoff to `bulletin-deploy`. Keep `DOT_TELEMETRY` as the privacy gate for both CLI telemetry and `BULLETIN_DEPLOY_TELEMETRY`.
- Keep `bulletin-deploy` pinned to an explicit version. Do not switch it to `latest`.
- `src/utils/deploy/*` and `src/utils/build/*` are SDK-facing surfaces for WebContainer consumers and must not import React or Ink.
- CLI/TUI code lives under `src/commands/*`.
- The Bun compiled-binary stdin warm-up in `src/index.ts` is intentional. Do not remove it until Bun compiled TTY stdin works reliably with Ink.

## Runtime Safety

- New long-running commands should register cleanup through `onProcessShutdown()` and use the process guard where appropriate.
- `startMemoryWatchdog()` runs for both `dot deploy` and `dot mod`; add it to new top-level commands that do meaningful I/O.
- TUI info updates must be throttled or coalesced. Do not stream raw high-volume logs directly into Ink state.
