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
import { checkBalance, pickFunder, FUNDER_FEE_BUFFER } from "../account/funding.js";
import { FAUCET_URL } from "../account/funder.js";
import { Enum, type PolkadotSigner } from "polkadot-api";
import { submitAndWatch } from "@polkadot-apps/tx";
import { withDeployPhase } from "./phase.js";
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
    /** Publish to the playground with private visibility (owner-only). Ignored when `publishToPlayground` is false. */
    playgroundPrivate?: boolean;
    /** Whether the deploy should publish source as modable. */
    modable?: boolean;
    /** Resolved public repository URL to record in metadata (modable=true) or `null` (modable=false). */
    repositoryUrl?: string | null;
    /** Compile + deploy foundry/hardhat/cdm contracts alongside the frontend. */
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
    /** Whether the contracts phase needs a phone tap to top up its session key. */
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

    // Contracts and frontend build+upload run concurrently; both must finish
    // before playground publish.
    const buildAbs = options.buildDir;

    const contractsPromise = maybeRunContracts(options, counter);

    const frontendPromise = (async () => {
        if (!options.skipBuild) {
            await withDeployPhase("build", "cli.deploy.build", {}, options.onEvent, async () => {
                const config = detectBuildConfig(loadDetectInput(options.projectDir));
                options.onEvent({ kind: "build-detected", config });
                await runBuild({
                    cwd: options.projectDir,
                    config,
                    onData: (line) => options.onEvent({ kind: "build-log", line }),
                });
            });
        }

        const storageAuth = maybeWrapAuthForSigning(
            setup.bulletinDeployAuthOptions,
            options,
            counter,
            setup.approvals,
        );
        return await withDeployPhase(
            "storage-and-dotns",
            "cli.deploy.storage-dotns",
            { "cli.deploy.domain": label },
            options.onEvent,
            () =>
                runStorageDeploy({
                    content: buildAbs,
                    domainName: label,
                    auth: storageAuth,
                    onLogEvent: (event) => options.onEvent({ kind: "storage-event", event }),
                    env: options.env,
                }),
        );
    })();

    const [contractsDeployed, storageResult] = await Promise.all([
        contractsPromise,
        frontendPromise,
    ]);

    // ── Playground publish ───────────────────────────────────────────────
    let metadataCid: string | undefined;
    if (setup.publishSigner) {
        const wrappedPublishSigner = wrapResolvedSigner(
            setup.publishSigner,
            "Publish to Playground registry",
            counter,
            (event) => options.onEvent({ kind: "signing", event }),
        );

        const pub = await withDeployPhase(
            "playground",
            "cli.deploy.playground",
            { "cli.deploy.domain": fullDomain },
            options.onEvent,
            () =>
                publishToPlayground({
                    domain: fullDomain,
                    publishSigner: wrappedPublishSigner,
                    repositoryUrl: options.repositoryUrl ?? null,
                    cwd: options.projectDir,
                    onLogEvent: (event) => options.onEvent({ kind: "storage-event", event }),
                    env: options.env,
                    isPrivate: options.playgroundPrivate,
                }),
        );
        metadataCid = pub.metadataCid;
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
 * Compile + deploy contracts using the on-disk session key. Fires
 * `phase-skipped` when disabled or no contract project is detected.
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

    return await withDeployPhase(
        "contracts",
        "cli.deploy.contracts",
        { "cli.deploy.contracts_type": contractsType },
        options.onEvent,
        async () => {
            const { info: session, created } = await getOrCreateSessionAccount();
            const client = await getConnection();

            await ensureSessionFunded({
                client,
                sessionAddress: session.account.ss58Address,
                userSigner: options.userSigner,
                counter,
                onEvent: options.onEvent,
            });
            if (created) {
                await submitAndWatch(
                    client.assetHub.tx.Revive.map_account(),
                    session.account.signer,
                );
            }

            const result = await runContractsPhase({
                projectDir: options.projectDir,
                contractsType,
                // cdm's PipelineChainClient is a structural subset of our
                // ChainClient — cast keeps the extra `individuality` field out
                // of the SDK-surface type without affecting runtime behaviour.
                client: client as unknown as Parameters<typeof runContractsPhase>[0]["client"],
                signer: session.account.signer,
                origin: session.account.ss58Address,
                onEvent: (event) => options.onEvent({ kind: "contracts-event", event }),
            });

            return result.deployed;
        },
    );
}

/** Top up the contracts session key if it's below `SESSION_MIN_BALANCE`. */
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

    // Phone signer: user pays, with a lifecycle event so the TUI numbers the
    // tap. Pure dev mode: pick the first funder in the chain that has enough
    // PAS to cover the top-up. If every dev funder is drained, tell the user
    // to switch to a mobile signer rather than silently falling back to
    // anything that might race the drainer.
    let funder: PolkadotSigner;
    if (opts.userSigner) {
        funder = wrapSignerWithEvents(opts.userSigner.signer, {
            label: "Fund contract deploy session key",
            counter: opts.counter,
            onEvent: (event) => opts.onEvent({ kind: "signing", event }),
        });
    } else {
        const picked = await pickFunder(opts.client, SESSION_FUND_AMOUNT + FUNDER_FEE_BUFFER);
        if (!picked) {
            throw new Error(
                `Dev account balance low. Please deploy with mobile signer. To top up funds in your mobile signer, go to the faucet at: ${FAUCET_URL}`,
            );
        }
        funder = picked.signer;
    }

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
