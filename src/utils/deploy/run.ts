// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

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
import { publishToPlayground, normalizeDomain } from "./playground.js";
import { runContractsPhase, type ContractsPhaseEvent } from "./contracts.js";
import {
    getOrCreateSessionAccount,
    persistSessionAccount,
    SESSION_FUND_AMOUNT,
    SESSION_MIN_BALANCE,
    type SessionKeyInfo,
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
import { submitAndWatch } from "@parity/product-sdk-tx";
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
    /** Whether the deploy should publish source as moddable. */
    moddable?: boolean;
    /** Resolved public repository URL to record in metadata (moddable=true) or `null` (moddable=false). */
    repositoryUrl?: string | null;
    /** Compile + deploy foundry/hardhat/cdm contracts alongside the frontend. */
    deployContracts?: boolean;
    /**
     * Skip the contract compile step (forge/hardhat/cargo-contract) and use
     * pre-existing artifacts on disk. CI-friendly for environments without the
     * contract toolchain installed. Throws if no artifacts are found.
     */
    skipContractBuild?: boolean;
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
    /** Whether the contracts phase signs with the mobile-backed product account. */
    contractsPhoneSigningNeeded?: boolean;
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
        contractsPhoneSigningNeeded: options.contractsPhoneSigningNeeded,
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
            async () => {
                const { runStorageDeploy } = await import("./storage.js");
                return await runStorageDeploy({
                    content: buildAbs,
                    domainName: label,
                    auth: storageAuth,
                    onLogEvent: (event) => options.onEvent({ kind: "storage-event", event }),
                    env: options.env,
                });
            },
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
 * Compile + deploy contracts. User signers deploy from the playground product
 * account; pure dev mode falls back to the on-disk session key.
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
            const client = await getConnection();
            const deployment = await resolveContractsDeploymentSigner({
                client,
                userSigner: options.userSigner,
                counter,
                onEvent: options.onEvent,
            });

            const result = await runContractsPhase({
                projectDir: options.projectDir,
                contractsType,
                skipBuild: options.skipContractBuild,
                // cdm's PipelineChainClient is a structural subset of our
                // ChainClient — cast keeps the extra `individuality` field out
                // of the SDK-surface type without affecting runtime behaviour.
                client: client as unknown as Parameters<typeof runContractsPhase>[0]["client"],
                signer: deployment.signer,
                origin: deployment.origin,
                onEvent: (event) => options.onEvent({ kind: "contracts-event", event }),
            });

            return result.deployed;
        },
    );
}

interface ContractsDeploymentSigner {
    signer: PolkadotSigner;
    origin: string;
}

async function resolveContractsDeploymentSigner(opts: {
    client: Awaited<ReturnType<typeof getConnection>>;
    userSigner: ResolvedSigner | null;
    counter: SigningCounter;
    onEvent: RunDeployOptions["onEvent"];
}): Promise<ContractsDeploymentSigner> {
    if (opts.userSigner) {
        const signer =
            opts.userSigner.source === "session"
                ? wrapSignerWithEvents(opts.userSigner.signer, {
                      label: "Deploy contracts",
                      counter: opts.counter,
                      onEvent: (event) => opts.onEvent({ kind: "signing", event }),
                  })
                : opts.userSigner.signer;
        return { signer, origin: opts.userSigner.address };
    }

    const { info: session, created } = await getOrCreateSessionAccount();
    await ensureSessionFunded({
        client: opts.client,
        session,
        onEvent: opts.onEvent,
    });
    if (created) {
        await submitAndWatch(opts.client.assetHub.tx.Revive.map_account(), session.account.signer);
        await persistSessionAccount(session);
    }
    return { signer: session.account.signer, origin: session.account.ss58Address };
}

/** Top up the pure-dev contracts session key if it's below `SESSION_MIN_BALANCE`. */
async function ensureSessionFunded(opts: {
    client: Awaited<ReturnType<typeof getConnection>>;
    session: SessionKeyInfo;
    onEvent: RunDeployOptions["onEvent"];
}): Promise<void> {
    const emitInfo = (message: string) =>
        opts.onEvent({ kind: "contracts-event", event: { kind: "info", message } });

    const sessionAddress = opts.session.account.ss58Address;
    const balance = await checkBalance(opts.client, sessionAddress, SESSION_MIN_BALANCE);
    if (balance.sufficient) {
        emitInfo(`session key funded (${sessionAddress})`);
        return;
    }

    emitInfo(`funding session key ${sessionAddress}…`);

    const picked = await pickFunder(opts.client, SESSION_FUND_AMOUNT + FUNDER_FEE_BUFFER);
    if (!picked) {
        throw new Error(
            `Dev account balance low. Please deploy with mobile signer. To top up funds in your mobile signer, go to the faucet at: ${FAUCET_URL}`,
        );
    }

    await submitAndWatch(
        opts.client.assetHub.tx.Balances.transfer_keep_alive({
            dest: Enum("Id", sessionAddress),
            value: SESSION_FUND_AMOUNT,
        }),
        picked.signer,
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
