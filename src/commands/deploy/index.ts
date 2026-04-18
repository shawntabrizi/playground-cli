import React from "react";
import { resolve } from "node:path";
import { Command, Option } from "commander";
import { render } from "ink";
import { DeployScreen } from "./DeployScreen.js";
import { renderSummaryText } from "./summary.js";
import { resolveSigner, SignerNotAvailableError, type ResolvedSigner } from "../../utils/signer.js";
import { getConnection, destroyConnection } from "../../utils/connection.js";
import { checkMapping } from "../../utils/account/mapping.js";
import { checkAllowance, LOW_TX_THRESHOLD } from "../../utils/account/allowance.js";
import {
    onProcessShutdown,
    scheduleHardExit,
    startMemoryWatchdog,
} from "../../utils/process-guard.js";
import {
    runDeploy,
    resolveSignerSetup,
    checkDomainAvailability,
    formatAvailability,
    type SignerMode,
    type DeployOutcome,
    type DeployEvent,
} from "../../utils/deploy/index.js";
import { buildSummaryView } from "./summary.js";
import { DEFAULT_BUILD_DIR, type Env } from "../../config.js";

interface DeployOpts {
    suri?: string;
    signer?: SignerMode;
    domain?: string;
    buildDir?: string;
    playground?: boolean;
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
    .option("--playground", "Publish to the playground registry")
    .option("--suri <suri>", "Secret URI for the user signer (e.g. //Alice for dev)")
    .addOption(
        new Option("--env <env>", "Target environment")
            .choices(["testnet", "mainnet"])
            .default("testnet"),
    )
    .option("--dir <path>", "Project directory", process.cwd())
    .action(async (opts: DeployOpts) => {
        const projectDir = resolve(opts.dir ?? process.cwd());
        const env: Env = (opts.env as Env) ?? "testnet";

        // Start the memory watchdog FIRST so it's in place even if a preflight
        // path starts leaking. It'll abort the process with a clear error if
        // RSS crosses 2 GB, protecting the machine from swap-death.
        const stopWatchdog = startMemoryWatchdog();

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
                stopWatchdog();
            };
        })();
        onProcessShutdown(cleanupOnce);

        try {
            userSigner = await preflight({ env, suri: opts.suri, mode: opts.signer });
        } catch (err) {
            process.stderr.write(`\n✖ ${formatError(err)}\n`);
            cleanupOnce();
            scheduleHardExit(1);
            return;
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
            if (nonInteractive) {
                await runHeadless({ projectDir, env, userSigner, opts });
            } else {
                await runInteractive({ projectDir, env, userSigner, opts });
            }
        } catch (err) {
            process.stderr.write(`\n✖ ${formatError(err)}\n`);
            process.exitCode = 1;
        } finally {
            cleanupOnce();
        }

        // Hard-exit safety net: after cleanup, if a stray WebSocket or
        // subscription is still keeping the event loop alive, we exit anyway
        // rather than hanging with a giant heap.
        const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
        scheduleHardExit(exitCode);
    });

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
}): Promise<ResolvedSigner | null> {
    // If the user explicitly asked for dev mode with no --playground and no
    // --suri, we don't need a signer at all.
    const mayNeedSigner = opts.mode !== "dev" || opts.suri !== undefined;
    if (!mayNeedSigner) return null;

    let signer: ResolvedSigner;
    try {
        signer = await resolveSigner({ suri: opts.suri });
    } catch (err) {
        if (err instanceof SignerNotAvailableError) {
            // Dev mode: we can still run without a signer as long as --playground
            // wasn't asked for. The caller validates that separately.
            if (opts.mode === "dev") return null;
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

    // Bulletin storage allowance is ONLY consumed when the user's signer is
    // used to submit `TransactionStorage.store` — that is, in phone mode.
    // In dev mode, bulletin-deploy uploads chunks via its own pool mnemonic
    // and the user's allowance isn't touched. Gating dev-mode deploys on
    // the user's allowance is a false block.
    if (opts.mode !== "dev") {
        const allowance = await checkAllowance(client, signer.address);
        if (!allowance.authorized || allowance.remainingTxs < LOW_TX_THRESHOLD) {
            signer.destroy();
            throw new Error(
                'Bulletin storage allowance is exhausted. Run "dot init" to refresh it.',
            );
        }
    }

    return signer;
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

    // Check availability BEFORE we build + upload, so CI fails fast on a
    // Reserved / already-taken name without wasting a chunk upload.
    process.stdout.write(`\nChecking availability of ${domain.replace(/\.dot$/, "") + ".dot"}…\n`);
    const availability = await checkDomainAvailability(domain, {
        env: ctx.env,
        ownerSs58Address: ctx.userSigner?.address,
    });
    if (availability.status !== "available") {
        throw new Error(formatAvailability(availability));
    }
    process.stdout.write(`✔ ${formatAvailability(availability)}\n`);

    const setup = resolveSignerSetup({
        mode,
        userSigner: ctx.userSigner,
        publishToPlayground,
        plan: availability.plan,
    });
    const view = buildSummaryView({
        mode,
        domain: availability.fullDomain,
        buildDir,
        publishToPlayground,
        approvals: setup.approvals,
    });
    process.stdout.write("\n" + renderSummaryText(view) + "\n");

    const outcome = await runDeploy({
        projectDir: ctx.projectDir,
        buildDir,
        domain,
        mode,
        publishToPlayground,
        userSigner: ctx.userSigner,
        plan: availability.plan,
        env: ctx.env,
        onEvent: (event) => logHeadlessEvent(event),
    });

    printFinalResult(outcome);
}

function runInteractive(ctx: {
    projectDir: string;
    env: Env;
    userSigner: ResolvedSigner | null;
    opts: DeployOpts;
}): Promise<void> {
    return new Promise((resolvePromise, rejectPromise) => {
        let settled = false;
        const app = render(
            React.createElement(DeployScreen, {
                projectDir: ctx.projectDir,
                domain: ctx.opts.domain ?? null,
                buildDir: ctx.opts.buildDir ?? null,
                mode: (ctx.opts.signer as SignerMode | undefined) ?? null,
                publishToPlayground:
                    ctx.opts.playground !== undefined ? Boolean(ctx.opts.playground) : null,
                userSigner: ctx.userSigner,
                onDone: (outcome: DeployOutcome | null) => {
                    if (settled) return;
                    settled = true;
                    app.unmount();
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
                    rejectPromise(new Error("TUI closed unexpectedly before the deploy finished."));
                }
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

function formatError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
