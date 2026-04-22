/**
 * Compile + deploy contracts for the `dot deploy` flow.
 *
 * Supports three project kinds (detected via `detectContractsType` in the
 * build-detect module):
 *   - `cdm`     — Rust/PVM, compiled with `@dotdm/contracts` `buildContracts`.
 *   - `foundry` — Solidity, compiled with `forge build --resolc` (the polkadot
 *                 fork's PolkaVM path).
 *   - `hardhat` — Solidity, compiled with `npx hardhat compile`, which runs
 *                 resolc under the hood when `@parity/hardhat-polkadot` is
 *                 loaded in the user's config.
 *
 * All three paths converge on a list of bytecode files on disk that we hand
 * to `ContractDeployer.deployBatch` for weight-aware batching via
 * `Utility.batch_all`. The bytes can be PVM or EVM — `Revive.instantiate_with_code`
 * polymorphically accepts both when the chain has `AllowEVMBytecode = true`
 * (Asset Hub paseo + hub do). No registry registration, no metadata publish
 * in v1 — that's opt-in future work.
 *
 * Kept free of React / Ink imports so RevX can consume this from a
 * WebContainer — see the "SDK surface" note in CLAUDE.md.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
    ContractDeployer,
    buildContracts,
    type BuildEvent as CdmBuildEvent,
    type PipelineChainClient,
} from "@dotdm/contracts";
import type { HexString, PolkadotSigner, SS58String } from "polkadot-api";
import type { ContractsType } from "../build/detect.js";

// ── Events ───────────────────────────────────────────────────────────────────

export type ContractsPhaseEvent =
    | { kind: "info"; message: string }
    /** Per-line stdout/stderr from the compile step (forge/hardhat) or cdm builder. */
    | { kind: "compile-log"; line: string }
    | { kind: "compile-detected"; contracts: string[] }
    | { kind: "deploy-chunk"; chunk: number; total: number; crates: string[] }
    | { kind: "deploy-done"; addresses: Array<{ name: string; address: HexString }> };

export interface RunContractsPhaseOptions {
    projectDir: string;
    contractsType: ContractsType;
    client: PipelineChainClient;
    signer: PolkadotSigner;
    /** SS58-encoded address of `signer`. Used as the deployer origin for dry-runs. */
    origin: SS58String;
    onEvent: (event: ContractsPhaseEvent) => void;
}

export interface ContractsPhaseResult {
    deployed: Array<{ name: string; address: HexString }>;
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function runContractsPhase(
    opts: RunContractsPhaseOptions,
): Promise<ContractsPhaseResult> {
    const artifacts = await compileContracts(opts);

    if (artifacts.length === 0) {
        opts.onEvent({
            kind: "info",
            message: "no contracts found to deploy",
        });
        return { deployed: [] };
    }

    opts.onEvent({
        kind: "compile-detected",
        contracts: artifacts.map((a) => a.name),
    });

    const deployer = new ContractDeployer(
        opts.signer,
        opts.origin,
        opts.client.raw.assetHub,
        opts.client.assetHub,
    );

    const pvmPaths = artifacts.map((a) => a.pvmPath);
    // `undefined` → skip CREATE2 salting. v1 ships non-deterministic contract
    // addresses because we don't publish metadata/registry entries that would
    // benefit from cross-chain determinism yet.
    let chunkOffset = 0;
    const batchResult = await deployer.deployBatch(pvmPaths, undefined, (chunkResult) => {
        const base = chunkOffset;
        chunkOffset += chunkResult.addresses.length;
        opts.onEvent({
            kind: "deploy-chunk",
            chunk: chunkResult.chunkIndex + 1,
            total: chunkResult.totalChunks,
            // cdm preserves input order across chunks, so the Nth address of a
            // chunk maps to `artifacts[base + N]`. Track the cumulative offset
            // via a closure counter so multi-chunk labels stay correct.
            crates: chunkResult.addresses.map(
                (_, i) => artifacts[base + i]?.name ?? `contract-${base + i}`,
            ),
        });
    });

    const deployed = artifacts.map((a, i) => ({
        name: a.name,
        address: batchResult.addresses[i] as HexString,
    }));
    opts.onEvent({ kind: "deploy-done", addresses: deployed });
    return { deployed };
}

// ── Compile dispatch ─────────────────────────────────────────────────────────

interface CompiledArtifact {
    /** Human-readable name (crate name for cdm, contract name for Solidity). */
    name: string;
    /**
     * Absolute path to the bytecode file on disk. Named `pvmPath` to match
     * cdm's `ContractDeployer.deployBatch(pvmPaths)` API; the bytes can be
     * PVM or EVM — revive's `instantiate_with_code` handles either.
     */
    pvmPath: string;
}

async function compileContracts(opts: RunContractsPhaseOptions): Promise<CompiledArtifact[]> {
    switch (opts.contractsType) {
        case "cdm":
            return compileCdm(opts);
        case "foundry":
            return compileFoundry(opts);
        case "hardhat":
            return compileHardhat(opts);
    }
}

// ── cdm compile ──────────────────────────────────────────────────────────────

async function compileCdm(opts: RunContractsPhaseOptions): Promise<CompiledArtifact[]> {
    const summary = await buildContracts({
        rootDir: opts.projectDir,
        onEvent: (event: CdmBuildEvent) => {
            relayCdmBuildEvent(event, opts.onEvent);
        },
    });

    const artifacts: CompiledArtifact[] = [];
    for (const c of summary.contracts) {
        if (c.error) {
            throw new Error(`cdm build failed for ${c.crate}: ${c.error}`);
        }
        if (!c.pvmPath) {
            throw new Error(`cdm build produced no bytecode path for ${c.crate}`);
        }
        artifacts.push({ name: c.crate, pvmPath: c.pvmPath });
    }
    return artifacts;
}

function relayCdmBuildEvent(event: CdmBuildEvent, emit: (e: ContractsPhaseEvent) => void) {
    if (event.type === "detect") {
        const crates = event.contracts.map((c) => c.name);
        emit({ kind: "compile-detected", contracts: crates });
    } else if (event.type === "build-start") {
        emit({ kind: "compile-log", line: `compiling ${event.crate}…` });
    } else if (event.type === "build-done") {
        emit({ kind: "compile-log", line: `compiled ${event.crate} (${event.bytecodeSize}B)` });
    } else if (event.type === "build-error") {
        emit({ kind: "compile-log", line: `error: ${event.crate} — ${event.error}` });
    }
}

// ── Foundry compile ──────────────────────────────────────────────────────────

async function compileFoundry(opts: RunContractsPhaseOptions): Promise<CompiledArtifact[]> {
    const projectDir = resolve(opts.projectDir);

    // `--resolc` forces PolkaVM codegen regardless of `foundry.toml`. Safer
    // than depending on user config — per our empirical test, plain
    // `forge build` emits EVM bytecode by default even on the polkadot fork.
    await runStreamed(
        {
            cmd: "forge",
            args: ["build", "--resolc"],
            cwd: projectDir,
            description: "forge build --resolc",
            failurePrefix: "forge build failed",
        },
        (line) => opts.onEvent({ kind: "compile-log", line }),
    );

    const outDir = join(projectDir, "out");
    if (!existsSync(outDir)) {
        throw new Error(`forge build did not produce an out/ directory at ${outDir}`);
    }

    const artifacts: CompiledArtifact[] = [];
    for (const entry of readdirSync(outDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        // Skip test (`Foo.t.sol`) and script (`Foo.s.sol`) directories —
        // deploying those would be a footgun.
        if (entry.name.endsWith(".t.sol") || entry.name.endsWith(".s.sol")) continue;
        if (!entry.name.endsWith(".sol")) continue;

        const contractName = entry.name.slice(0, -".sol".length);
        const artifactPath = join(outDir, entry.name, `${contractName}.json`);
        if (!existsSync(artifactPath)) continue;

        const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
            bytecode?: { object?: string };
        };
        const hex = artifact.bytecode?.object;
        if (typeof hex !== "string") continue;
        const bytes = hexToBytes(hex);
        // Abstract contracts / interfaces compile to "0x" — skip them.
        if (bytes.length === 0) continue;

        artifacts.push({
            name: contractName,
            pvmPath: writeTmpBytecode(`foundry-${contractName}`, bytes),
        });
    }

    return artifacts;
}

// ── Hardhat compile ──────────────────────────────────────────────────────────

async function compileHardhat(opts: RunContractsPhaseOptions): Promise<CompiledArtifact[]> {
    const projectDir = resolve(opts.projectDir);

    await runStreamed(
        {
            cmd: "npx",
            args: ["hardhat", "compile"],
            cwd: projectDir,
            description: "npx hardhat compile",
            failurePrefix: "hardhat compile failed",
        },
        (line) => opts.onEvent({ kind: "compile-log", line }),
    );

    const artifactsRoot = join(projectDir, "artifacts", "contracts");
    if (!existsSync(artifactsRoot)) {
        throw new Error(
            `hardhat compile did not produce artifacts/contracts/ at ${artifactsRoot} — did you load "@parity/hardhat-polkadot" in your hardhat.config?`,
        );
    }

    const artifacts: CompiledArtifact[] = [];
    for (const entry of readdirSync(artifactsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.endsWith(".sol")) continue;

        const dir = join(artifactsRoot, entry.name);
        for (const sub of readdirSync(dir)) {
            // Skip debug files (`Foo.dbg.json`) — they don't have bytecode.
            if (!sub.endsWith(".json") || sub.endsWith(".dbg.json")) continue;

            const contractName = sub.slice(0, -".json".length);
            const artifact = JSON.parse(readFileSync(join(dir, sub), "utf8")) as {
                bytecode?: string;
            };
            const hex = artifact.bytecode;
            if (typeof hex !== "string") continue;
            const bytes = hexToBytes(hex);
            // Abstract contracts / interfaces compile to "0x" — skip them.
            if (bytes.length === 0) continue;

            artifacts.push({
                name: contractName,
                pvmPath: writeTmpBytecode(`hardhat-${contractName}`, bytes),
            });
        }
    }

    return artifacts;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) {
        throw new Error(`invalid hex string (odd length): ${hex.slice(0, 20)}…`);
    }
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

let tmpDirForSession: string | null = null;
/** Allocate a per-session tmp dir so a failed deploy's artifacts stick around for inspection. */
function sessionTmpDir(): string {
    if (tmpDirForSession !== null) return tmpDirForSession;
    const dir = join(tmpdir(), `dot-contracts-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    tmpDirForSession = dir;
    return dir;
}

/**
 * Persist a contract byte blob to a file that `ContractDeployer.deploy` can
 * read back. Works for PVM and EVM bytes alike — revive auto-dispatches.
 */
function writeTmpBytecode(stem: string, bytes: Uint8Array): string {
    const path = join(sessionTmpDir(), `${stem}.bin`);
    writeFileSync(path, bytes);
    return path;
}

/** Same streaming-child-process helper shape `runner.ts` uses — duplicated to keep this file import-light. */
async function runStreamed(
    opts: {
        cmd: string;
        args: string[];
        cwd: string;
        description: string;
        failurePrefix: string;
    },
    onData: (line: string) => void,
): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(opts.cmd, opts.args, {
            cwd: opts.cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
        });

        const tail: string[] = [];
        const MAX_TAIL = 50;

        const forward = (chunk: Buffer) => {
            for (const line of chunk.toString().split("\n")) {
                if (line.length === 0) continue;
                tail.push(line);
                if (tail.length > MAX_TAIL) tail.shift();
                onData(line);
            }
        };

        child.stdout.on("data", forward);
        child.stderr.on("data", forward);
        child.on("error", (err) =>
            rejectPromise(
                new Error(`Failed to spawn "${opts.description}": ${err.message}`, { cause: err }),
            ),
        );
        child.on("close", (code) => {
            if (code === 0) {
                resolvePromise();
            } else {
                const snippet = tail.slice(-10).join("\n") || "(no output)";
                rejectPromise(
                    new Error(
                        `${opts.failurePrefix} (${opts.description}) with exit code ${code}.\n${snippet}`,
                    ),
                );
            }
        });
    });
}
