/**
 * Orchestrator for the full `dot deploy` flow.
 *
 * The function is deliberately pure-ish: it takes an already-resolved signer,
 * emits a typed event stream, and leaves UI concerns (Ink, spinners) to the
 * caller. RevX can import this module in a WebContainer and drive its own UI
 * off the same events.
 */

import {
    runBuild,
    loadDetectInput,
    detectBuildConfig,
    detectContractsType,
    type BuildConfig,
    type ContractsType,
} from "../build/index.js";
import { runStorageDeploy } from "./storage.js";
import { publishToPlayground, normalizeDomain } from "./playground.js";
import { runContractsPhase, type ContractsPhaseEvent } from "./contracts.js";
import { resolveSignerSetup, type SignerMode, type DeployApproval } from "./signerMode.js";
import {
    wrapSignerWithEvents,
    createSigningCounter,
    type SigningCounter,
    type SigningEvent,
} from "./signingProxy.js";
import type { DeployLogEvent } from "./progress.js";
import { resolveSigner, type ResolvedSigner } from "../signer.js";
import { getConnection } from "../connection.js";
import type { Env } from "../../config.js";
import type { DeployPlan } from "./availability.js";
import type { HexString } from "polkadot-api";

// ── Events ───────────────────────────────────────────────────────────────────

export type DeployPhase = "build" | "contracts" | "storage-and-dotns" | "playground" | "done";

export type DeployEvent =
    | { kind: "plan"; approvals: DeployApproval[] }
    | { kind: "phase-start"; phase: DeployPhase }
    | { kind: "phase-complete"; phase: DeployPhase }
    | { kind: "phase-skipped"; phase: DeployPhase; reason: string }
    | { kind: "build-log"; line: string }
    | { kind: "build-detected"; config: BuildConfig }
    | { kind: "contracts-event"; event: ContractsPhaseEvent }
    | { kind: "storage-event"; event: DeployLogEvent }
    | { kind: "signing"; event: SigningEvent }
    | { kind: "error"; phase: DeployPhase; message: string };

// ── Inputs & outputs ─────────────────────────────────────────────────────────

export interface RunDeployOptions {
    /** Project root — where the build runs. */
    projectDir: string;
    /** Relative path inside `projectDir` that holds the built artifacts. */
    buildDir: string;
    /** Skip the build step (e.g. if the caller already built). */
    skipBuild?: boolean;
    /** DotNS label (with or without `.dot`). */
    domain: string;
    /** Signer mode — `dev` uses bulletin-deploy defaults, `phone` uses the user's session. */
    mode: SignerMode;
    /** Whether to publish to the playground registry after DotNS succeeds. */
    publishToPlayground: boolean;
    /**
     * Whether to compile + deploy the project's contracts (foundry / hardhat /
     * cdm). When true, the contracts phase runs after `build`; when false
     * (default) the phase emits a `phase-skipped` event and returns immediately.
     */
    deployContracts?: boolean;
    /** The logged-in phone signer. Required for `mode === "phone"` or `publishToPlayground`. */
    userSigner: ResolvedSigner | null;
    /** Event sink — consumed by the TUI / RevX. */
    onEvent: (event: DeployEvent) => void;
    /** Target environment. Defaults to `testnet`. */
    env?: Env;
    /**
     * DotNS plan from the availability check — shapes the approvals list.
     * Optional; the signing counter falls back to "register, no PoP upgrade"
     * (3 DotNS taps) if absent and auto-corrects at runtime.
     */
    plan?: DeployPlan;
}

export interface DeployOutcome {
    /** Canonical `<label>.dot` string. */
    fullDomain: string;
    /** Bulletin storage CID of the app bundle. */
    appCid: string;
    /** IPFS CID of the directory root, if bulletin-deploy computed one. */
    ipfsCid?: string;
    /** Metadata CID when `publishToPlayground` was true. */
    metadataCid?: string;
    /** Approvals the user actually went through, useful for final summary. */
    approvalsRequested: DeployApproval[];
    /** URL the user can visit to view their deployed app. */
    appUrl: string;
    /** Contract addresses deployed this run (empty when contracts phase was skipped). */
    contracts: Array<{ name: string; address: HexString }>;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export async function runDeploy(options: RunDeployOptions): Promise<DeployOutcome> {
    const { label, fullDomain } = normalizeDomain(options.domain);

    const setup = resolveSignerSetup({
        mode: options.mode,
        userSigner: options.userSigner,
        publishToPlayground: options.publishToPlayground,
        plan: options.plan,
    });

    options.onEvent({ kind: "plan", approvals: setup.approvals });

    const counter = createSigningCounter(setup.approvals.length);

    // ── Build ────────────────────────────────────────────────────────────
    const buildAbs = options.buildDir;
    if (!options.skipBuild) {
        options.onEvent({ kind: "phase-start", phase: "build" });
        try {
            const config = detectBuildConfig(loadDetectInput(options.projectDir));
            options.onEvent({ kind: "build-detected", config });
            await runBuild({
                cwd: options.projectDir,
                config,
                onData: (line) => options.onEvent({ kind: "build-log", line }),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            options.onEvent({ kind: "error", phase: "build", message });
            throw err;
        }
        options.onEvent({ kind: "phase-complete", phase: "build" });
    }

    // ── Contracts ────────────────────────────────────────────────────────
    const contractsDeployed = await maybeRunContracts(options);

    // ── Storage + DotNS via bulletin-deploy ──────────────────────────────
    options.onEvent({ kind: "phase-start", phase: "storage-and-dotns" });

    const storageAuth = maybeWrapAuthForSigning(
        setup.bulletinDeployAuthOptions,
        options,
        counter,
        setup.approvals,
    );

    let storageResult;
    try {
        storageResult = await runStorageDeploy({
            content: buildAbs,
            domainName: label,
            auth: storageAuth,
            onLogEvent: (event) => options.onEvent({ kind: "storage-event", event }),
            env: options.env,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        options.onEvent({ kind: "error", phase: "storage-and-dotns", message });
        throw err;
    }
    options.onEvent({ kind: "phase-complete", phase: "storage-and-dotns" });

    // ── Playground publish ───────────────────────────────────────────────
    let metadataCid: string | undefined;
    if (setup.publishSigner) {
        options.onEvent({ kind: "phase-start", phase: "playground" });
        const wrappedPublishSigner = wrapResolvedSigner(
            setup.publishSigner,
            "Publish to Playground registry",
            counter,
            (event) => options.onEvent({ kind: "signing", event }),
        );

        try {
            const pub = await publishToPlayground({
                domain: fullDomain,
                publishSigner: wrappedPublishSigner,
                cwd: options.projectDir,
                onLogEvent: (event) => options.onEvent({ kind: "storage-event", event }),
                env: options.env,
            });
            metadataCid = pub.metadataCid;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            options.onEvent({ kind: "error", phase: "playground", message });
            throw err;
        }
        options.onEvent({ kind: "phase-complete", phase: "playground" });
    }

    const appUrl = buildAppUrl(fullDomain, options.env);
    const outcome: DeployOutcome = {
        fullDomain,
        appCid: storageResult.cid,
        ipfsCid: storageResult.ipfsCid,
        metadataCid,
        approvalsRequested: setup.approvals,
        appUrl,
        contracts: contractsDeployed,
    };
    options.onEvent({ kind: "phase-complete", phase: "done" });
    return outcome;
}

// ── Contracts orchestration ──────────────────────────────────────────────────

/**
 * Run the contracts phase when `deployContracts` is true and a recognized
 * foundry/hardhat/cdm project is detected. Fires `phase-skipped` in every
 * other case (user said no, nothing detected, etc.) so the UI can collapse
 * the row without leaving it "pending" forever.
 *
 * Signer resolution:
 *   - phone mode   → reuse `userSigner` (same key that signs DotNS / playground).
 *   - dev mode     → resolve `//Alice` on the fly. This mirrors how the rest of
 *                    the `dev` path works — bulletin-deploy uses its own
 *                    DEFAULT_MNEMONIC for storage, and we deliberately don't
 *                    entangle the contracts signer with that one.
 */
async function maybeRunContracts(options: RunDeployOptions): Promise<DeployOutcome["contracts"]> {
    if (!options.deployContracts) {
        options.onEvent({
            kind: "phase-skipped",
            phase: "contracts",
            reason: "contracts deploy not requested",
        });
        return [];
    }

    const contractsType: ContractsType | null = detectContractsType(
        loadDetectInput(options.projectDir),
    );
    if (contractsType === null) {
        options.onEvent({
            kind: "phase-skipped",
            phase: "contracts",
            reason: "no foundry/hardhat/cdm project detected at the root",
        });
        return [];
    }

    options.onEvent({ kind: "phase-start", phase: "contracts" });

    let contractsSigner: ResolvedSigner | null = null;
    let ownsContractsSigner = false;
    try {
        if (options.mode === "phone") {
            if (!options.userSigner) {
                throw new Error(
                    "contracts deploy requires a signed-in phone session in --signer phone mode",
                );
            }
            contractsSigner = options.userSigner;
        } else {
            contractsSigner = await resolveSigner({ suri: "//Alice" });
            ownsContractsSigner = true;
        }

        const client = await getConnection();
        const result = await runContractsPhase({
            projectDir: options.projectDir,
            contractsType,
            // @polkadot-apps/chain-client returns `ChainClient<{assetHub,
            // bulletin, individuality}>`; cdm only needs the first two. The
            // structural extra field is harmless at runtime.
            client: client as unknown as Parameters<typeof runContractsPhase>[0]["client"],
            signer: contractsSigner.signer,
            origin: contractsSigner.address,
            onEvent: (event) => options.onEvent({ kind: "contracts-event", event }),
        });

        options.onEvent({ kind: "phase-complete", phase: "contracts" });
        return result.deployed;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        options.onEvent({ kind: "error", phase: "contracts", message });
        throw err;
    } finally {
        if (ownsContractsSigner && contractsSigner) {
            try {
                contractsSigner.destroy();
            } catch {}
        }
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * When bulletin-deploy is about to use the user's phone signer for DotNS, wrap
 * it so each `signTx` call surfaces a lifecycle event with the right label.
 *
 * Labels are pulled from the DotNS-phase entries of `setup.approvals`, in
 * order. `resolveSignerSetup` built that list to match bulletin-deploy's
 * actual on-chain call sequence (including the optional `setUserPopStatus`
 * at the start when a PoP upgrade is needed), so `seen === N` → phone shows
 * the Nth entry. If bulletin-deploy ever fires *more* sigs than approvals
 * anticipated, we fall back to the last known label — better than emitting
 * a bogus index — and `createSigningCounter` simultaneously extends `total`
 * so the TUI shows "step N of N" instead of "N of N-1".
 */
function maybeWrapAuthForSigning(
    auth: ReturnType<typeof resolveSignerSetup>["bulletinDeployAuthOptions"],
    options: RunDeployOptions,
    counter: SigningCounter,
    approvals: DeployApproval[],
) {
    if (!auth.signer || !auth.signerAddress) return auth;

    const labels = approvals.filter((a) => a.phase === "dotns").map((a) => a.label);
    const fallbackLabel = labels[labels.length - 1] ?? "DotNS step";
    let seen = 0;
    const wrapped = {
        publicKey: auth.signer.publicKey,
        signTx: (...args: Parameters<typeof auth.signer.signTx>) => {
            const label = labels[seen] ?? fallbackLabel;
            seen += 1;
            const proxy = wrapSignerWithEvents(auth.signer!, {
                label,
                counter,
                onEvent: (event) => options.onEvent({ kind: "signing", event }),
            });
            return proxy.signTx(...args);
        },
        signBytes: (...args: Parameters<typeof auth.signer.signBytes>) => {
            const proxy = wrapSignerWithEvents(auth.signer!, {
                label: "DotNS signBytes",
                counter,
                onEvent: (event) => options.onEvent({ kind: "signing", event }),
            });
            return proxy.signBytes(...args);
        },
    };

    return { ...auth, signer: wrapped };
}

function wrapResolvedSigner(
    resolved: ResolvedSigner,
    label: string,
    counter: SigningCounter,
    onEvent: (event: SigningEvent) => void,
): ResolvedSigner {
    return {
        ...resolved,
        signer: wrapSignerWithEvents(resolved.signer, { label, counter, onEvent }),
    };
}

function buildAppUrl(fullDomain: string, _env: Env | undefined): string {
    // Today's dot.li viewer handles both testnet and mainnet; revisit once a
    // dedicated mainnet viewer domain is announced.
    return `https://${fullDomain}.li`;
}
