# CLAUDE.md

Refer to the **Contributing** and **Architecture Highlights** sections of [README.md](./README.md) for development workflows, release process, and repo conventions.

## Non-obvious invariants

These are things that aren't self-evident from reading the code and have bitten us before:

- **Do not upgrade `polkadot-api` or `@polkadot-api/sdk-ink`** past the current pins without also bumping `@polkadot-apps/chain-client`. Newer versions break the internal `PolkadotClient` shape that `chain-client` still relies on.
- **The mobile app wraps `signRaw` data with `<Bytes>…</Bytes>`**, which breaks transaction signing. Our `src/utils/signer.ts` exists specifically to route transactions through `signPayload` instead. Delete this file once `@polkadot-apps/terminal` ships a fix — nothing else.
- **`getSessionSigner()` returns an adapter that keeps the Node event loop alive**. Every caller must invoke the returned `destroy()` when done. If you add a new top-level command that signs on behalf of the user, wire up the cleanup or the process will hang after the work is done.
- **`dot init` auto-runs at the end of `install.sh`**. If the init fails, the exit code is surfaced so CI runs don't silently pass.

## Repo conventions

- Tests are `*.test.ts` next to the source. `vitest.config.ts` only picks up `.test.ts`; if you add `.tsx` tests update the config too.
- Pure logic that lives inside a `.tsx` component should be lifted into a sibling `.ts` file (see `completion.ts` next to `InitScreen.tsx`, or the `formatPas`/`formatMb` exports in `AccountSetup.tsx`). Tests can then import it without dragging React + Ink into the vitest runner.
- Do NOT add Claude attribution (`Co-Authored-By: Claude`, emoji signatures, etc.) to commits, PRs, or generated files.
- Do NOT commit design docs, brainstorming notes, or context dumps (e.g. `context.md`) to the repo. They belong in tickets or scratch files outside the tree.
- Don't mock primitives from `polkadot-api` (`Enum`, encoders) in tests — doing so turns intended coverage into tautology.
- Long-lived resources (`TerminalAdapter`, `PaseoClient`) have explicit `destroy()` / `destroyConnection()` — always release them, especially from React `useEffect` cleanups. The WebSocket keeps the event loop alive; forgetting a destroy manifests as `dot <cmd>` hanging after its work is visibly finished.
