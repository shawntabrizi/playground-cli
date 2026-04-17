/**
 * Orchestrator for the full `dot deploy` flow.
 *
 * The function is deliberately pure-ish: it takes an already-resolved signer,
 * emits a typed event stream, and leaves UI concerns (Ink, spinners) to the
 * caller. RevX can import this module in a WebContainer and drive its own UI
 * off the same events.
 */

import { runBuild, loadDetectInput, detectBuildConfig, type BuildConfig } from "../build/index.js";
import { runStorageDeploy } from "./storage.js";
import { publishToPlayground, normalizeDomain } from "./playground.js";
import { resolveSignerSetup, type SignerMode, type DeployApproval } from "./signerMode.js";
import {
    wrapSignerWithEvents,
    createSigningCounter,
    type SigningCounter,
    type SigningEvent,
} from "./signingProxy.js";
import type { DeployLogEvent } from "./progress.js";
import type { ResolvedSigner } from "../signer.js";
import type { Env } from "../../config.js";

// ── Events ───────────────────────────────────────────────────────────────────

export type DeployPhase = "build" | "storage-and-dotns" | "playground" | "done";

export type DeployEvent =
    | { kind: "plan"; approvals: DeployApproval[] }
    | { kind: "phase-start"; phase: DeployPhase }
    | { kind: "phase-complete"; phase: DeployPhase }
    | { kind: "build-log"; line: string }
    | { kind: "build-detected"; config: BuildConfig }
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
    /** The logged-in phone signer. Required for `mode === "phone"` or `publishToPlayground`. */
    userSigner: ResolvedSigner | null;
    /** Event sink — consumed by the TUI / RevX. */
    onEvent: (event: DeployEvent) => void;
    /** Target environment. Defaults to `testnet`. */
    env?: Env;
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
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export async function runDeploy(options: RunDeployOptions): Promise<DeployOutcome> {
    const { label, fullDomain } = normalizeDomain(options.domain);

    const setup = resolveSignerSetup({
        mode: options.mode,
        userSigner: options.userSigner,
        publishToPlayground: options.publishToPlayground,
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

    // ── Storage + DotNS via bulletin-deploy ──────────────────────────────
    options.onEvent({ kind: "phase-start", phase: "storage-and-dotns" });

    const storageAuth = maybeWrapAuthForSigning(setup.bulletinDeployAuthOptions, options, counter);

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
    };
    options.onEvent({ kind: "phase-complete", phase: "done" });
    return outcome;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * When bulletin-deploy is about to use the user's phone signer for DotNS, wrap
 * it so each `signTx` call surfaces a lifecycle event. We wrap only once and
 * let the signer distinguish calls by step number (DotNS runs three sigs).
 */
function maybeWrapAuthForSigning(
    auth: ReturnType<typeof resolveSignerSetup>["bulletinDeployAuthOptions"],
    options: RunDeployOptions,
    counter: SigningCounter,
) {
    if (!auth.signer || !auth.signerAddress) return auth;

    const labels = ["Reserve domain", "Finalize domain", "Link content"];
    let seen = 0;
    const wrapped = {
        publicKey: auth.signer.publicKey,
        signTx: (...args: Parameters<typeof auth.signer.signTx>) => {
            // Bulletin-deploy's current DotNS path makes exactly one signTx
            // per logical step, so `seen` matches the intended label. If a
            // future version retries signTx inside a step, `seen` would
            // drift past `labels.length` and we'd show "DotNS step 4" on
            // the phone — misleading. Cap at the last label so a retry
            // reuses the most recent step name instead of inventing one.
            const idx = Math.min(seen, labels.length - 1);
            const label = labels[idx];
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
