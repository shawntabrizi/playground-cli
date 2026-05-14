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

import React from "react";
import { resolve } from "node:path";
import { Command, Option } from "commander";
import { render } from "ink";
import { renderSummaryText } from "./summary.js";
import { errorMessage, withSpan } from "../../telemetry.js";
import { resolveSigner, SignerNotAvailableError, type ResolvedSigner } from "../../utils/signer.js";
import { getConnection, destroyConnection } from "../../utils/connection.js";
import { checkMapping } from "../../utils/account/mapping.js";
import { onProcessShutdown } from "../../utils/process-guard.js";
import { runCliCommand } from "../../cli-runtime.js";
import {
    resolveSignerSetup,
    type SignerMode,
    type DeployApproval,
} from "../../utils/deploy/signerMode.js";
import {
    checkDomainAvailability,
    formatAvailability,
    type AvailabilityResult,
} from "../../utils/deploy/availability.js";
import type { DeployOutcome, DeployEvent } from "../../utils/deploy/run.js";
import { buildSummaryView } from "./summary.js";
import { detectContractsType, type ContractsType } from "../../utils/build/detect.js";
import { loadDetectInput } from "../../utils/build/runner.js";
import { readSessionAccount, SESSION_MIN_BALANCE } from "../../utils/deploy/session-account.js";
import { checkBalance } from "../../utils/account/funding.js";
import { DEFAULT_BUILD_DIR, type Env, resolveLegacyEnv } from "../../config.js";
import { ensureGitInstalled, resolveRepositoryUrl } from "../../utils/deploy/moddable.js";

interface DeployOpts {
    suri?: string;
    signer?: SignerMode;
    domain?: string;
    buildDir?: string;
    playground?: boolean;
    /** Publish to the playground with private visibility (owner-only). Only meaningful with `--playground`. */
    private?: boolean;
    /**
     * Commander's auto-negated boolean: defaults to `true`; `--no-build` flips it to `false`.
     * We never check for `undefined` here since commander always provides a boolean when
     * a `--no-foo` option is declared.
     */
    build?: boolean;
    /**
     * Commander's auto-negated boolean: defaults to `true`; `--no-contract-build` flips it to `false`.
     * When false, the contract compile step (forge/hardhat/cargo-contract) is skipped and
     * pre-existing artifacts on disk are used instead. CI-friendly for environments without
     * the contract toolchains installed.
     */
    contractBuild?: boolean;
    /** Deploy the project's contracts alongside the frontend. Defaults to false. */
    contracts?: boolean;
    /** Publish the source repo so others can `dot mod` it. Commander auto-negates: `--no-moddable` ⇒ false. */
    moddable?: boolean;
    env?: Env;
    /** Project root. Hidden — defaults to cwd. */
    dir?: string;
}

export const deployCommand = new Command("deploy")
    .description(
        "Build the project, upload to Bulletin, register a .dot domain, and optionally publish to Playground",
    )
    .addOption(new Option("--signer <mode>", "Signer mode").choices(["dev", "phone"]))
    .option("--domain <name>", "DotNS domain (e.g. my-app or my-app.dot)")
    .option(
        "--buildDir <path>",
        `Directory containing build artifacts (default: ${DEFAULT_BUILD_DIR})`,
    )
    .option("--no-build", "Skip the build step and deploy existing artifacts in buildDir")
    .option(
        "--contracts",
        "Also deploy any contracts detected in the project (foundry/hardhat/cdm)",
    )
    .option(
        "--no-contract-build",
        "Skip the contract compile step (forge/hardhat/cargo-contract) and deploy existing pre-built artifacts. Requires --contracts. Useful for CI environments without the contract toolchains installed.",
    )
    .option("--playground", "Publish to the playground registry")
    .option(
        "--private",
        "Publish to the playground with private visibility (owner-only). Requires --playground.",
    )
    .option(
        "--moddable",
        "Publish the source repo so others can `dot mod` it. Requires --playground and a public GitHub `origin`.",
    )
    .option("--no-moddable", "Explicitly skip publishing source (the default).")
    .option("--suri <suri>", "Secret URI for the user signer (e.g. //Alice for dev)")
    .addOption(
        new Option("--env <env>", "Target environment")
            // Accept the new env IDs (mirroring bulletin-deploy) plus the legacy
            // `testnet|mainnet` aliases so existing scripts keep working.
            .choices([
                "preview",
                "paseo-next",
                "paseo-review",
                "paseo-next-v2",
                "polkadot",
                "kusama",
                "testnet",
                "mainnet",
            ])
            .default("paseo-next-v2"),
    )
    .option("--dir <path>", "Project directory", process.cwd())
    .action(async (opts: DeployOpts) =>
        runCliCommand("deploy", { watchdog: true, hardExit: true }, async () => {
            const projectDir = resolve(opts.dir ?? process.cwd());
            const env: Env = resolveLegacyEnv(opts.env ?? "paseo-next-v2");

            let userSigner: ResolvedSigner | null = null;

            // Guarantee cleanup runs even if the main flow never returns — e.g.,
            // a leaked WebSocket keeps the event loop alive. The signal handlers
            // in process-guard will invoke this on SIGINT/TERM/HUP too.
            const cleanupOnce = (() => {
                let ran = false;
                return () => {
                    if (ran) return;
                    ran = true;
                    try {
                        userSigner?.destroy();
                    } catch {}
                    try {
                        destroyConnection();
                    } catch {}
                };
            })();
            onProcessShutdown(cleanupOnce);

            try {
                userSigner = await withSpan(
                    "cli.deploy.preflight",
                    "deploy preflight",
                    { "cli.deploy.env": env },
                    () =>
                        preflight({
                            env,
                            suri: opts.suri,
                            mode: opts.signer,
                            publishToPlayground: opts.playground === true,
                        }),
                );
            } catch (err) {
                process.stderr.write(`\n✖ ${errorMessage(err)}\n`);
                cleanupOnce();
                process.exitCode = 1;
                throw err;
            }

            // Release the Asset Hub client we opened for preflight mapping +
            // allowance checks. Nothing else in the deploy path (build, chunk
            // upload, bulletin-deploy's own DotNS preflight + registration)
            // touches `getConnection()` — and holding an idle polkadot-api client
            // with a live best-block subscription for the entire deploy window
            // was a measurable contributor to background memory pressure. The
            // playground publish step calls `getConnection()` which auto-creates
            // a fresh client at that point.
            destroyConnection();

            try {
                const nonInteractive = isFullySpecified(opts);

                if (opts.contractBuild === false && opts.contracts && !nonInteractive) {
                    throw new Error(
                        "--no-contract-build requires headless mode (combine with --signer, --domain, --buildDir, --playground).",
                    );
                }

                if (nonInteractive) {
                    await runHeadless({ projectDir, env, userSigner, opts });
                } else {
                    await runInteractive({ projectDir, env, userSigner, opts });
                }
            } catch (err) {
                process.stderr.write(`\n✖ ${errorMessage(err)}\n`);
                process.exitCode = 1;
                throw err;
            } finally {
                cleanupOnce();
            }
        }),
    );

// ── Preflight ────────────────────────────────────────────────────────────────

/**
 * Make sure we can actually deploy before spending the user's time on prompts:
 *   - user has a signer (either --suri dev or a QR session),
 *   - their account is mapped in Revive (needed for any EVM call),
 *   - their Bulletin storage allowance isn't about to be exhausted.
 *
 * Dev mode without --playground doesn't need a signer at all — we skip the
 * check in that case so a brand-new user can do `dot deploy --signer dev` out
 * of the box.
 */
async function preflight(opts: {
    env: Env;
    suri?: string;
    mode?: SignerMode;
    publishToPlayground?: boolean;
}): Promise<ResolvedSigner | null> {
    // If the user explicitly asked for dev mode with no --playground and no
    // --suri, we don't need a signer at all.
    if (!shouldResolveUserSigner(opts)) return null;

    let signer: ResolvedSigner;
    try {
        signer = await resolveSigner({ suri: opts.suri });
    } catch (err) {
        if (err instanceof SignerNotAvailableError) {
            // Pure dev mode can still run without a signer, but playground
            // publish needs the logged-in account so registry ownership lands
            // on the user instead of a shared dev key.
            if (opts.mode === "dev" && !opts.publishToPlayground) return null;
            throw err;
        }
        throw err;
    }

    // Dev accounts don't need a mapping/allowance check — Alice & friends are
    // already set up on the test chains. Only gate on real session accounts.
    if (signer.source !== "session") return signer;

    const client = await getConnection();

    // Mapping is always required — the playground registry publish + any
    // DotNS signing go through EVM contract calls, which need the user's
    // SS58 to be mapped to an H160 via `Revive::map_account`. So we always
    // check mapping, in both dev and phone modes.
    const mapped = await checkMapping(client, signer.address);
    if (!mapped) {
        signer.destroy();
        throw new Error(
            'Account is not mapped in Revive. Run "dot init" first to finish account setup.',
        );
    }

    // Allowance preflight removed for paseo-next-v2: under the host-granted
    // allowance model, Bulletin authorizations are held by the host's slot
    // account keys (not the user's SS58 address), so a direct
    // `TransactionStorage.Authorizations` query by `signer.address` would
    // always return "not authorized" and produce a false block. bulletin-deploy
    // 0.7.19 surfaces a clear "Payment" error if the host's allowance is
    // missing — the user runs `dot init` to re-request.

    return signer;
}

export function shouldResolveUserSigner(opts: {
    suri?: string;
    mode?: SignerMode;
    publishToPlayground?: boolean;
}): boolean {
    return opts.mode !== "dev" || opts.suri !== undefined || opts.publishToPlayground === true;
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

function isFullySpecified(opts: DeployOpts): boolean {
    return (
        typeof opts.signer === "string" &&
        typeof opts.domain === "string" &&
        typeof opts.buildDir === "string" &&
        typeof opts.playground === "boolean"
    );
}

async function runHeadless(ctx: {
    projectDir: string;
    env: Env;
    userSigner: ResolvedSigner | null;
    opts: DeployOpts;
}) {
    const mode = ctx.opts.signer as SignerMode;
    const publishToPlayground = Boolean(ctx.opts.playground);
    const domain = ctx.opts.domain as string;
    const buildDir = ctx.opts.buildDir as string;
    const skipBuild = ctx.opts.build === false;
    const deployContracts = Boolean(ctx.opts.contracts);
    const skipContractBuild = ctx.opts.contractBuild === false;
    const contractsType = safeDetectContractsType(ctx.projectDir);
    if (deployContracts && contractsType === null) {
        throw new Error(
            "--contracts was passed but no foundry/hardhat/cdm project was detected at the root.",
        );
    }

    // Check availability BEFORE we build + upload, so CI fails fast on a
    // Reserved / already-taken name without wasting a chunk upload.
    //
    // `ownerSs58Address` MUST match whoever will actually sign the DotNS
    // `register()` extrinsic — otherwise the preflight reports "taken" on a
    // re-deploy. Phone mode signs with the session account; dev-with-SURI signs
    // with that local account. Pure dev mode still falls back to bulletin-deploy's
    // built-in DEFAULT_MNEMONIC, so we omit the address there.
    process.stdout.write(`\nChecking availability of ${domain.replace(/\.dot$/, "") + ".dot"}…\n`);
    const dotnsOwnerSs58Address =
        mode === "phone"
            ? ctx.userSigner?.address
            : ctx.userSigner?.source === "dev"
              ? ctx.userSigner.address
              : undefined;
    const availability = await withSpan(
        "cli.deploy.availability",
        "check domain availability",
        { "cli.deploy.domain": domain.replace(/\.dot$/, "") },
        () =>
            checkDomainAvailability(domain, {
                env: ctx.env,
                ownerSs58Address: dotnsOwnerSs58Address,
            }),
    );
    if (availability.status !== "available") {
        throw new Error(formatAvailability(availability));
    }
    process.stdout.write(`✔ ${formatAvailability(availability)}\n`);

    const moddable = ctx.opts.moddable === true;

    let repositoryUrl: string | null = null;
    if (moddable) {
        if (!publishToPlayground) {
            throw new Error(
                "--moddable requires --playground (no metadata is published without it).",
            );
        }
        repositoryUrl = await withSpan(
            "cli.deploy.moddable",
            "prepare moddable repository",
            async () => {
                await ensureGitInstalled();
                return resolveRepositoryUrl({
                    cwd: ctx.projectDir,
                    onLog: (line) => process.stdout.write(`${line}\n`),
                });
            },
        );
    }

    const contractsFundingNeeded = await withSpan(
        "cli.deploy.contracts-funding-check",
        "check contracts session funding",
        { "cli.deploy.contracts": deployContracts ? "true" : "false" },
        () =>
            computeContractsFundingNeeded({
                deployContracts,
                userSigner: ctx.userSigner,
            }),
    );

    const setup = resolveSignerSetup({
        mode,
        userSigner: ctx.userSigner,
        publishToPlayground,
        plan: availability.plan,
        contractsFundingNeeded,
    });
    const view = buildSummaryView({
        mode,
        domain: availability.fullDomain,
        buildDir,
        skipBuild,
        publishToPlayground,
        moddable,
        repositoryUrl,
        approvals: setup.approvals,
        // See the matching note in DeployScreen.tsx: phone mode and dev-with-SURI
        // sign as the resolved user signer; pure dev mode (no --suri) falls back
        // to bulletin-deploy's DEFAULT_MNEMONIC, which we don't surface here.
        signerAddress:
            mode === "phone" || ctx.userSigner?.source === "dev"
                ? ctx.userSigner?.address
                : undefined,
    });
    process.stdout.write("\n" + renderSummaryText(view) + "\n");

    const outcome = await withSpan(
        "cli.deploy.orchestrator",
        "run deploy orchestrator",
        {
            "cli.deploy.mode": mode,
            "cli.deploy.playground": publishToPlayground ? "true" : "false",
            "cli.deploy.moddable": moddable ? "true" : "false",
            "cli.deploy.contracts": deployContracts ? "true" : "false",
        },
        async () => {
            const { runDeploy } = await import("../../utils/deploy/run.js");
            return await runDeploy({
                projectDir: ctx.projectDir,
                buildDir,
                skipBuild,
                domain,
                mode,
                publishToPlayground,
                playgroundPrivate: Boolean(ctx.opts.private),
                moddable,
                repositoryUrl,
                deployContracts,
                skipContractBuild,
                contractsFundingNeeded,
                userSigner: ctx.userSigner,
                plan: availability.plan,
                env: ctx.env,
                onEvent: (event) => logHeadlessEvent(event),
            });
        },
    );

    printFinalResult(outcome);
}

/** Best-effort contract-project detection; null on any I/O error. */
export function safeDetectContractsType(projectDir: string): ContractsType | null {
    try {
        return detectContractsType(loadDetectInput(projectDir));
    } catch {
        return null;
    }
}

/** Whether the contracts phase will need a phone tap to top up the session key. */
export async function computeContractsFundingNeeded(args: {
    deployContracts: boolean;
    userSigner: ResolvedSigner | null;
}): Promise<boolean> {
    if (!args.deployContracts) return false;
    if (args.userSigner?.source !== "session") return false;
    try {
        const session = await readSessionAccount();
        if (session === null) return true;
        const client = await getConnection();
        const { sufficient } = await checkBalance(
            client,
            session.account.ss58Address,
            SESSION_MIN_BALANCE,
        );
        return !sufficient;
    } catch {
        return true;
    }
}

function runInteractive(ctx: {
    projectDir: string;
    env: Env;
    userSigner: ResolvedSigner | null;
    opts: DeployOpts;
}): Promise<void> {
    const contractsType = safeDetectContractsType(ctx.projectDir);
    return new Promise((resolvePromise, rejectPromise) => {
        let settled = false;
        let app: ReturnType<typeof render> | null = null;
        import("./DeployScreen.js")
            .then(({ DeployScreen }) => {
                app = render(
                    React.createElement(DeployScreen, {
                        projectDir: ctx.projectDir,
                        domain: ctx.opts.domain ?? null,
                        buildDir: ctx.opts.buildDir ?? null,
                        mode: (ctx.opts.signer as SignerMode | undefined) ?? null,
                        publishToPlayground:
                            ctx.opts.playground !== undefined ? Boolean(ctx.opts.playground) : null,
                        playgroundPrivate: Boolean(ctx.opts.private),
                        // Only pre-fill when the user explicitly asked to skip via `--no-build`;
                        // otherwise show the prompt so they can hit Enter on the default "yes".
                        skipBuild: ctx.opts.build === false ? true : null,
                        contractsType,
                        deployContracts:
                            ctx.opts.contracts !== undefined ? ctx.opts.contracts : null,
                        moddable:
                            ctx.opts.moddable === true
                                ? true
                                : ctx.opts.moddable === false
                                  ? false
                                  : null,
                        userSigner: ctx.userSigner,
                        onDone: (outcome: DeployOutcome | null) => {
                            if (settled) return;
                            settled = true;
                            app?.unmount();
                            if (outcome === null) {
                                process.exitCode = 1;
                                rejectPromise(new Error("Deploy was cancelled or failed."));
                            } else {
                                resolvePromise();
                            }
                        },
                    }),
                );

                // `waitUntilExit()` resolves when the Ink app unmounts and rejects on
                // render errors. Either resolution could happen WITHOUT `onDone`
                // firing — e.g. Ink's error boundary unmounting on a render throw —
                // in which case the outer promise would hang forever. Force-settle
                // if we see the app go down unexpectedly.
                app.waitUntilExit()
                    .then(() => {
                        if (!settled) {
                            settled = true;
                            process.exitCode = 1;
                            rejectPromise(
                                new Error("TUI closed unexpectedly before the deploy finished."),
                            );
                        }
                    })
                    .catch((err) => {
                        if (!settled) {
                            settled = true;
                            rejectPromise(err);
                        }
                    });
            })
            .catch((err) => {
                if (!settled) {
                    settled = true;
                    rejectPromise(err);
                }
            });
    });
}

// ── Output helpers ───────────────────────────────────────────────────────────

function logHeadlessEvent(event: DeployEvent) {
    if (event.kind === "phase-start") {
        process.stdout.write(`▸ ${event.phase}…\n`);
    } else if (event.kind === "phase-complete") {
        process.stdout.write(`✔ ${event.phase}\n`);
    } else if (event.kind === "build-log") {
        process.stdout.write(`  ${event.line}\n`);
    } else if (event.kind === "storage-event" && event.event.kind === "chunk-progress") {
        process.stdout.write(`  chunk ${event.event.current}/${event.event.total}\n`);
    } else if (event.kind === "signing" && event.event.kind === "sign-request") {
        process.stdout.write(
            `  📱 Approve on your phone: ${event.event.label} (${event.event.step}/${event.event.total})\n`,
        );
    } else if (event.kind === "error") {
        process.stderr.write(`  ✖ ${event.phase}: ${event.message}\n`);
    }
}

function printFinalResult(outcome: DeployOutcome) {
    process.stdout.write(`\n✔ Deploy complete\n\n`);
    process.stdout.write(`  URL         ${outcome.appUrl}\n`);
    process.stdout.write(`  Domain      ${outcome.fullDomain}\n`);
    process.stdout.write(`  App CID     ${outcome.appCid}\n`);
    if (outcome.ipfsCid) process.stdout.write(`  IPFS CID    ${outcome.ipfsCid}\n`);
    if (outcome.metadataCid) process.stdout.write(`  Metadata CID ${outcome.metadataCid}\n`);
    process.stdout.write("\n");
}
