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
 * `dot decentralize` — point at a live static site, get back a .dot URL.
 *
 *   dot decentralize                                          # interactive
 *   dot decentralize --site=shawntabrizi.github.io            # headless
 *   dot decentralize --site=foo.com --dot=bar                 # headless, explicit name
 *   dot decentralize --site=foo.com --suri=//Bob              # headless, dev signer
 *   dot decentralize --site=foo.com --playground              # also publish to playground
 *
 * Headless flow runs when `--site` is provided (preserves the existing
 * `dot decentralize --suri=//Bob` demo-service contract). Without `--site`,
 * the command mounts an Ink TUI that prompts for URL → signer → domain →
 * publish? before kicking off the same upload pipeline. The publish-to-
 * playground step delegates to deploy's `publishToPlayground` helper.
 */

import { Command } from "commander";
import React from "react";
import { render } from "ink";
import { runCliCommand } from "../../cli-runtime.js";
import { errorMessage, withSpan } from "../../telemetry.js";
import { DEFAULT_ENV, type Env, resolveLegacyEnv } from "../../config.js";
import { resolveSigner, type ResolvedSigner, SignerNotAvailableError } from "../../utils/signer.js";
import { resolveDomain } from "../../utils/decentralize/domain.js";
import {
    describeDeployEvent,
    runDecentralize,
    type DecentralizeOutcome,
} from "../../utils/decentralize/run.js";
import { destroyConnection } from "../../utils/connection.js";
import type { SignerMode } from "../../utils/deploy/signerMode.js";
import { onProcessShutdown } from "../../utils/process-guard.js";

interface DecentralizeOpts {
    site?: string;
    dot?: string;
    env: string;
    suri?: string;
    /**
     * Commander coerces `--playground` (no arg) to `true` and the flag's
     * absence to `undefined`. We treat `undefined` as "ask in the TUI / skip
     * in headless" — i.e. opt-in publish.
     */
    playground?: boolean;
}

export const decentralizeCommand = new Command("decentralize")
    .description(
        "Mirror a live static site to Polkadot Bulletin and register a .dot name pointing at it",
    )
    .option(
        "--site <url>",
        "URL of the static site to clone (http/https). Omit to launch the interactive TUI.",
    )
    .option(
        "--dot <name>",
        "DotNS domain (with or without `.dot`). Omit to auto-generate a free random name.",
    )
    .option("--env <env>", "Target environment (default: paseo-next-v2)", DEFAULT_ENV)
    .option(
        "--suri <suri>",
        "Sign with this SURI (dev name like //Bob, or a BIP-39 mnemonic). " +
            "Default: the session signer paired by `playground init`.",
    )
    .option(
        "--playground",
        "After upload, also publish a minimal AppInfo entry to the playground registry " +
            "(visible in the playground-app's Apps tab). Off by default.",
    )
    .action(async (opts: DecentralizeOpts) =>
        runCliCommand("decentralize", { hardExit: true }, async () => {
            const env: Env = resolveLegacyEnv(opts.env);
            if (opts.site) {
                await runHeadless({ env, opts });
            } else {
                await runInteractive({ env, opts });
            }
        }),
    );

// ── Headless path (preserves the existing dot decentralize --site=... contract) ─

async function runHeadless({
    env,
    opts,
}: {
    env: Env;
    opts: DecentralizeOpts;
}): Promise<void> {
    let signer: ResolvedSigner | null = null;

    try {
        signer = await withSpan("cli.decentralize.signer", "resolve signer", () =>
            resolveSigner({ suri: opts.suri }),
        );

        process.stdout.write(`\n▸ Signing as ${signer.address} (${signer.source})\n`);

        const { label, fullDomain } = await resolveDomain({
            env,
            providedDot: opts.dot,
            siteUrl: opts.site!,
            signer,
            onMessage: (line) => process.stdout.write(`${line}\n`),
        });

        // Headless mode: "dev" when --suri was passed (signer.source === "dev"),
        // "phone" when we fell back to the session signer (source === "session").
        const mode: SignerMode = signer.source === "session" ? "phone" : "dev";

        process.stdout.write(`\n▸ Mirroring ${opts.site}…\n`);
        const outcome = await runDecentralize({
            siteUrl: opts.site!,
            label,
            fullDomain,
            mode,
            userSigner: signer,
            publishToPlayground: opts.playground === true,
            env,
            onEvent: (ev) => {
                switch (ev.kind) {
                    case "mirror-line":
                        process.stdout.write(`  ${ev.line}\n`);
                        break;
                    case "mirror-done":
                        process.stdout.write(
                            `  → ${ev.fileCount} files in ${ev.directory}\n` +
                                `\n▸ Uploading to Bulletin and registering ${fullDomain}…\n`,
                        );
                        break;
                    case "storage-event": {
                        const line = describeDeployEvent(ev.event);
                        if (line) process.stdout.write(`  • ${line}\n`);
                        break;
                    }
                    case "playground-start":
                        process.stdout.write(`\n▸ Publishing ${ev.fullDomain} to playground…\n`);
                        break;
                    case "playground-event": {
                        const line = describeDeployEvent(ev.event);
                        if (line) process.stdout.write(`  • ${line}\n`);
                        break;
                    }
                    case "signing":
                        if (ev.event.kind === "sign-request") {
                            process.stdout.write(
                                `\n  ▸ Check your phone — approve step ${ev.event.step}/${ev.event.total}: ${ev.event.label}\n`,
                            );
                        } else if (ev.event.kind === "sign-error") {
                            process.stdout.write(`  ✖ signing failed: ${ev.event.message}\n`);
                        }
                        break;
                }
            },
        });

        printHeadlessSuccess(outcome);
    } catch (err) {
        process.stderr.write(`\n✖ ${errorMessage(err)}\n`);
        process.exitCode = 1;
        throw err;
    } finally {
        signer?.destroy();
        destroyConnection();
    }
}

// ── Interactive path ─────────────────────────────────────────────────────────

async function runInteractive({
    env,
    opts,
}: {
    env: Env;
    opts: DecentralizeOpts;
}): Promise<void> {
    // Preflight: resolve an explicit --suri signer if provided, otherwise try the
    // persisted session — tolerating its absence so the picker can still offer
    // the dev option.
    const preflight = await withSpan("cli.decentralize.preflight", "decentralize preflight", () =>
        resolvePreflightSigner(opts.suri),
    );

    const cleanupOnce = (() => {
        let ran = false;
        return () => {
            if (ran) return;
            ran = true;
            try {
                preflight.explicitSigner?.destroy();
            } catch {}
            try {
                preflight.sessionSigner?.destroy();
            } catch {}
            // Release the shared Asset Hub WS that publishToPlayground opens
            // via getConnection(). Without this the event loop stays alive and
            // `dot decentralize` hangs after the work visibly finishes (the
            // CLAUDE.md "hanging after work finishes" gotcha).
            try {
                destroyConnection();
            } catch {}
        };
    })();
    onProcessShutdown(cleanupOnce);

    try {
        const { DecentralizeScreen } = await import("./DecentralizeScreen.js");

        await new Promise<void>((resolvePromise, rejectPromise) => {
            let settled = false;
            const app = render(
                React.createElement(DecentralizeScreen, {
                    env,
                    initialSiteUrl: opts.site ?? null,
                    initialDot: opts.dot ?? null,
                    explicitSigner: preflight.explicitSigner,
                    sessionSigner: preflight.sessionSigner,
                    initialPublishToPlayground: opts.playground === true ? true : null,
                    onDone: (result) => {
                        if (settled) return;
                        settled = true;
                        app.unmount();
                        // The TUI has already rendered the user-visible message —
                        // never re-log here. Cancel and success both exit 0; only
                        // a real failure throws so telemetry records the SAD% bump.
                        switch (result.kind) {
                            case "success":
                            case "cancel":
                                resolvePromise();
                                break;
                            case "error":
                                process.exitCode = 1;
                                rejectPromise(new Error(result.message));
                                break;
                        }
                    },
                }),
            );

            app.waitUntilExit().catch((err) => {
                if (!settled) {
                    settled = true;
                    rejectPromise(err);
                }
            });
        });
    } finally {
        cleanupOnce();
    }
}

interface PreflightSigners {
    /** Signer explicitly chosen by `--suri`. Picker is skipped when set. */
    explicitSigner: ResolvedSigner | null;
    /** Session signer from `dot init`, if any. Drives the "phone" picker option. */
    sessionSigner: ResolvedSigner | null;
}

async function resolvePreflightSigner(suri: string | undefined): Promise<PreflightSigners> {
    if (suri) {
        return {
            explicitSigner: await resolveSigner({ suri }),
            sessionSigner: null,
        };
    }
    try {
        return {
            explicitSigner: null,
            sessionSigner: await resolveSigner({}),
        };
    } catch (err) {
        if (err instanceof SignerNotAvailableError) {
            return { explicitSigner: null, sessionSigner: null };
        }
        throw err;
    }
}

// ── Shared helpers ───────────────────────────────────────────────────────────

export function printHeadlessSuccess(outcome: DecentralizeOutcome): void {
    const lines = [
        "\n✔ Decentralized!",
        `  Site         ${outcome.appUrl}`,
        `  IPFS CID     ${outcome.ipfsCid}`,
        `  Gateway      ${outcome.gatewayUrl}`,
    ];
    if (outcome.metadataCid) {
        lines.push(`  Metadata CID ${outcome.metadataCid}`);
    }
    process.stdout.write(`${lines.join("\n")}\n`);
    if (outcome.signerSource === "dev") {
        process.stdout.write(
            "\n  To deploy to a domain owned by you, run `playground init` and re-run\n" +
                "  `playground decentralize` with the mobile signer.\n",
        );
    }
    process.stdout.write("\n");
}
