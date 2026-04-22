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
import {
    getOrCreateSessionAccount,
    SESSION_FUND_AMOUNT,
    SESSION_MIN_BALANCE,
} from "./session-account.js";
import { resolveSignerSetup, type SignerMode, type DeployApproval } from "./signerMode.js";
import {
    wrapSignerWithEvents,
    createSigningCounter,
    type SigningCounter,
    type SigningEvent,
} from "./signingProxy.js";
import type { DeployLogEvent } from "./progress.js";
import { checkBalance } from "../account/funding.js";
import { Enum } from "polkadot-api";
import { submitAndWatch, createDevSigner } from "@polkadot-apps/tx";
import type { ResolvedSigner } from "../signer.js";
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
    /**
     * Whether the contracts phase will need to top up its session key. Passed
     * through so the internal `resolveSignerSetup` call produces the same
     * approvals total the caller (CLI summary / confirm page) already
     * showed — otherwise the TUI's "step N of M" counter displays the wrong
     * total until the funding tap auto-extends it mid-flight.
     */
    contractsFundingNeeded?: boolean;
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
        contractsFundingNeeded: options.contractsFundingNeeded,
    });

    options.onEvent({ kind: "plan", approvals: setup.approvals });

    const counter = createSigningCounter(setup.approvals.length);

    // Contracts and frontend-build+upload are independent and run concurrently.
    // Contracts work is network-bound (chain txs); frontend work is CPU-bound
    // (vite/next) + network-bound (bulletin chunks). They share no state, so
    // the only coordination needed is that both must finish before playground
    // publish.
    const buildAbs = options.buildDir;

    const contractsPromise = maybeRunContracts(options, counter);

    const frontendPromise = (async () => {
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

        options.onEvent({ kind: "phase-start", phase: "storage-and-dotns" });
        const storageAuth = maybeWrapAuthForSigning(
            setup.bulletinDeployAuthOptions,
            options,
            counter,
            setup.approvals,
        );
        try {
            const storageResult = await runStorageDeploy({
                content: buildAbs,
                domainName: label,
                auth: storageAuth,
                onLogEvent: (event) => options.onEvent({ kind: "storage-event", event }),
                env: options.env,
            });
            options.onEvent({ kind: "phase-complete", phase: "storage-and-dotns" });
            return storageResult;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            options.onEvent({ kind: "error", phase: "storage-and-dotns", message });
            throw err;
        }
    })();

    const [contractsDeployed, storageResult] = await Promise.all([
        contractsPromise,
        frontendPromise,
    ]);

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
 *   Contract deploys are signed by a persistent on-disk **session key**
 *   (`~/.polkadot/accounts.json`), not the user's main signer. Why: the
 *   mobile signer can't handle the encoded size of a batched contract
 *   deploy today, and its failure mode is miscategorised downstream (the
 *   phone's error message contains "rejected" → `@polkadot-apps/tx` flags
 *   it as a user-cancel, discarding the real cause). A local sr25519 key
 *   funded once per session sidesteps the mobile-signing path entirely.
 *
 *   Funding source for the session key:
 *     - user signer present (phone mode, or `--suri`) → user pays, one
 *       on-phone tap per low-balance top-up.
 *     - pure dev mode (no user signer)               → fund from Alice.
 *
 *   Consequence: contracts are owned by the session H160, not the user's.
 *   Fine for v1 — we're on testnet and there's no contract registry
 *   ownership record yet. Revisit when we either (a) have a mobile signer
 *   that can sign large txs, or (b) publish contracts to the registry with
 *   owner semantics that matter.
 */
async function maybeRunContracts(
    options: RunDeployOptions,
    counter: SigningCounter,
): Promise<DeployOutcome["contracts"]> {
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

    try {
        const { info: session, created } = await getOrCreateSessionAccount();
        const client = await getConnection();

        // One-shot top-up — signed by whoever is available (user's signer
        // in phone/--suri mode, Alice as a dev fallback). Funding only
        // happens when the session key is below threshold, so day-2 runs
        // usually skip this step entirely.
        await ensureSessionFunded({
            client,
            sessionAddress: session.account.ss58Address,
            userSigner: options.userSigner,
            counter,
            onEvent: options.onEvent,
        });
        if (created) {
            await submitAndWatch(client.assetHub.tx.Revive.map_account(), session.account.signer);
        }

        const result = await runContractsPhase({
            projectDir: options.projectDir,
            contractsType,
            // @polkadot-apps/chain-client returns `ChainClient<{assetHub,
            // bulletin, individuality}>`; cdm only needs the first two. The
            // structural extra field is harmless at runtime.
            client: client as unknown as Parameters<typeof runContractsPhase>[0]["client"],
            signer: session.account.signer,
            origin: session.account.ss58Address,
            onEvent: (event) => options.onEvent({ kind: "contracts-event", event }),
        });

        options.onEvent({ kind: "phase-complete", phase: "contracts" });
        return result.deployed;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        options.onEvent({ kind: "error", phase: "contracts", message });
        throw err;
    }
}

/**
 * Top up the contracts session key if it's underfunded. Emits
 * `contracts-event` info lines for the TUI and, when the user's own signer
 * pays, wires the `signing` event stream so the "check your phone" prompt
 * shows up like every other phone approval. A no-op when the balance is
 * already above `MIN_BALANCE` — that's the common case after the first deploy.
 */
async function ensureSessionFunded(opts: {
    client: Awaited<ReturnType<typeof getConnection>>;
    sessionAddress: string;
    userSigner: ResolvedSigner | null;
    counter: SigningCounter;
    onEvent: RunDeployOptions["onEvent"];
}): Promise<void> {
    const emitInfo = (message: string) =>
        opts.onEvent({ kind: "contracts-event", event: { kind: "info", message } });

    const balance = await checkBalance(opts.client, opts.sessionAddress, SESSION_MIN_BALANCE);
    if (balance.sufficient) {
        emitInfo(`session key funded (${opts.sessionAddress})`);
        return;
    }

    emitInfo(`funding session key ${opts.sessionAddress}…`);

    // User signer (phone session or --suri dev key) pays when available.
    // Pure dev mode (no userSigner and no --suri) falls back to Alice —
    // same pattern `dot init` already uses to bootstrap new accounts.
    const funder = opts.userSigner
        ? wrapSignerWithEvents(opts.userSigner.signer, {
              label: "Fund contract deploy session key",
              counter: opts.counter,
              onEvent: (event) => opts.onEvent({ kind: "signing", event }),
          })
        : createDevSigner("Alice");

    await submitAndWatch(
        opts.client.assetHub.tx.Balances.transfer_keep_alive({
            dest: Enum("Id", opts.sessionAddress),
            value: SESSION_FUND_AMOUNT,
        }),
        funder,
    );

    emitInfo("session key funded");
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
