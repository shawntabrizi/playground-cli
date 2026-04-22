# Request: artifact-driven `deployContracts` entry point

## Context

`playground-cli` wants a single code path to deploy contracts from **foundry** / **hardhat** / **cdm** projects. Today we only consume `ContractDeployer.deployBatch(pvmPaths)` (low-level). We'd like to use `deployContracts(...)` (high-level: deploy + batch + registry publish + bulletin metadata publish) for all three, but the current signature is Rust-workspace-only — it takes `rootDir` and walks Cargo metadata.

The ask: let `deployContracts` accept a **pre-built list of artifacts** (bytecode + optional metadata) instead of walking `rootDir`. Rust keeps its current convenience; Solidity becomes first-class. `ContractDeployer.deployBatch` underneath stays unchanged.

## Proposed API surface

### New input type (exported from `@dotdm/contracts`)

```ts
export interface ContractArtifact {
    /** Human-readable name — used for event labels and (if metadata.cdmPackage is set) CREATE2 salt. */
    name: string;
    /** Raw PVM bytecode. Accepts bytes rather than a path so callers don't have to round-trip through disk. */
    pvmBytes: Uint8Array;
    /** Optional — present for every language that can emit an ABI. */
    abi?: AbiEntry[];
    /** Optional — omit to deploy without registry publish or bulletin metadata. */
    metadata?: ContractMetadata;
    /**
     * Optional — crate/package names this contract's constructor reads addresses from.
     * cdm's existing toposort uses this for layered deploy ordering. Solidity callers
     * typically leave empty (constructor args aren't supported here yet anyway).
     */
    dependsOn?: string[];
}

export interface ContractMetadata {
    /** Publishable name (e.g. "@polkadot/reputation"). Required for registry publish + CREATE2 salt. */
    cdmPackage: string;
    description?: string;
    authors?: string[];
    homepage?: string;
    repository?: string;
    /** README body (bytes). cdm already handles an absent or oversized README gracefully — keep that. */
    readme?: string;
}
```

### New entry point: `deployArtifacts`

```ts
export interface DeployArtifactsOptions {
    artifacts: ContractArtifact[];

    // same chain plumbing that `deployContracts` already takes:
    client: PipelineChainClient;
    signer: PolkadotSigner;
    origin: SS58String;
    registryAddress: HexString;

    waitFor?: "best-block" | "finalized";
    timeoutMs?: number;
    gateway?: string;

    onEvent?: (e: DeployEvent) => void;
}

export async function deployArtifacts(opts: DeployArtifactsOptions): Promise<DeploySummary>;
```

Behavior:

- **No metadata on an artifact** → deploy only (skip `MetadataPublisher.publish` + `RegistryManager.register` for that contract). Per-artifact, not global — a mixed batch of some-with some-without is legal.
- **All artifacts lacking metadata** → skip the registry connection entirely; don't require a `registryAddress`. (Make `registryAddress` optional when the batch has zero publishable artifacts.)
- **Layering** — when `dependsOn` is populated, run the same toposort already in `pipeline.ts` against the artifact list. When it isn't, treat everything as a single layer. This unifies Rust (has `dependsOn`, inferred from Cargo deps) and Solidity (no `dependsOn`, all parallel).
- Emits the same `DeployEvent` stream; `crates` is replaced by `artifacts[].name` throughout.

### Keep `deployContracts(rootDir)` — make it a thin wrapper

Refactor `pipeline.ts:deployContracts` into:

```ts
export async function deployContracts(opts: DeployContractsOptions): Promise<DeploySummary> {
    // 1. detect + build (existing code)
    const detected = detectAndFilter(opts.rootDir, opts.contracts);
    const built    = await runBuildPhase(opts.rootDir, ...);

    // 2. pull metadata for each built crate (existing detection.ts logic — see export request below)
    const artifacts = built.map(b => ({
        name: b.crate,
        pvmBytes: readFileSync(b.pvmPath),
        abi: ...,
        metadata: detectContractMetadata(opts.rootDir, b.crate),
        dependsOn: contractMap.get(b.crate)!.dependsOnCrates,
    }));

    // 3. delegate
    return deployArtifacts({ ...opts, artifacts });
}
```

Existing callers unaffected.

### Export the metadata detector

cdm already has all the Rust-side metadata discovery in `detection.ts` — Cargo.toml parsing, `readmePath`, `getGitRemoteUrl`. Surface it as a standalone helper so other tools (playground-cli, RevX, etc.) can opt into cdm-quality metadata without reimplementing:

```ts
export function detectContractMetadata(rootDir: string, crateName: string): ContractMetadata | null;
```

Used internally by the `deployContracts` wrapper above. A playground-cli cdm-path caller can also use it directly to enrich the `ContractArtifact.metadata` field before passing to `deployArtifacts` — same result, but the caller controls the timing.

## Why this shape

- **Bytes, not paths.** Solidity builds land artifact JSON in `out/<C>.sol/<C>.json` (foundry) or `artifacts/contracts/<C>.sol/<C>.json` (hardhat). We already decode them in-memory; writing to tmp files just to hand cdm a path is round-trip noise.
- **Optional metadata, per-artifact.** Solidity won't have a `@org/name` unless the user declares one externally (future work — a `contracts.ts` config file along hardhat's lines). We want `deployArtifacts` to work today without that, and gracefully register when the metadata is supplied tomorrow.
- **No new deploy primitive.** `ContractDeployer.deployBatch(pvmPaths, cdmPackages?, onChunk?)` stays unchanged. `deployArtifacts` writes the bytes to temp files internally if needed (or — better — teach `deployBatch` to accept `{ pvm: Uint8Array; cdmPackage?: string }[]` so we avoid the tmp hop entirely, but that's a separate cleanup).

## Out of scope

- Constructor args. Our current pipeline hardcodes `data: Binary.fromBytes(new Uint8Array(0))`. Solidity contracts with constructor args are blocked on a separate story (likely a `contracts.ts` config). When that lands, add a `constructorArgs?: Uint8Array` or `constructorArgs?: { abi, args }` field to `ContractArtifact` and thread through to `instantiate_with_code`.
- H160/EVM-bytecode-only artifacts. We assume resolc has been run upstream — bytes are PVM. cdm can optionally validate the `0x50564d00` magic on entry and throw early (playground-cli already does this on the Solidity paths, but duplicating at the cdm boundary is cheap and helps other callers).

## Minimal acceptance criteria

1. `deployArtifacts({ artifacts: [...], client, signer, origin })` exists, ignores `rootDir`, and deploys the artifact list.
2. Artifacts with `metadata.cdmPackage` produce a registry publish; artifacts without skip it.
3. `registryAddress` is optional when nothing in the batch has metadata.
4. `deployContracts({ rootDir, ... })` — the current function — still works unchanged, now implemented on top of `deployArtifacts`.
5. `detectContractMetadata(rootDir, crateName)` is exported.
6. A test harness (even if hand-rolled) that calls `deployArtifacts` with (a) all metadata (b) no metadata (c) mixed — all three round-trip through cdm without touching `rootDir` or Cargo.

## Knock-on improvement in playground-cli

Once this lands, `src/utils/deploy/contracts.ts` drops the deploy orchestration (~70 lines — tmp-file writing, PVM magic check, chunk-index bookkeeping, `ContractDeployer` plumbing), collapsing that side to:

```ts
const artifacts: ContractArtifact[] = await compileByType(contractsType, projectDir);
await deployArtifacts({ artifacts, client, signer, origin, ... });
```

The compile side (~250 lines of foundry/hardhat artifact-JSON parsing, `.t.sol`/`.s.sol`/`.dbg.json` skip lists, spawn helpers) stays in playground-cli — that's tooling-specific knowledge, not "contract dependency manager" scope.

## Optional extension (stretch)

If cdm wants to own the solidity frontends too, export:

```ts
export async function buildFoundryProject(projectDir: string): Promise<ContractArtifact[]>;
export async function buildHardhatProject(projectDir: string): Promise<ContractArtifact[]>;
```

Both spawn the right compile command, parse the respective artifact JSON, validate PVM magic, return `ContractArtifact[]` ready for `deployArtifacts`. This would reduce playground-cli's `contracts.ts` to ~50 lines of pure dispatch. **Trade-off:** it significantly expands cdm's surface (foundry/hardhat toolchain invariants now ship via cdm releases), which may be outside the project's charter. Flagging it as a possibility, not a request — happy with either outcome.
