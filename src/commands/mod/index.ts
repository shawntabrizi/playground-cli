import React from "react";
import { render } from "ink";
import { Command } from "commander";
import { existsSync } from "node:fs";
import { withCommandTelemetry, withSpan } from "../../telemetry.js";
import { resolveSigner } from "../../utils/signer.js";
import { getConnection, destroyConnection } from "../../utils/connection.js";
import { getRegistryContract } from "../../utils/registry.js";
import { AppBrowser, type AppEntry } from "./AppBrowser.js";
import { SetupScreen } from "./SetupScreen.js";
import { defaultRepoName } from "../../utils/git/repoName.js";
import {
    onProcessShutdown,
    scheduleHardExit,
    startMemoryWatchdog,
} from "../../utils/process-guard.js";

export const modCommand = new Command("mod")
    .description("Mod a playground app — clone the source as a fresh project to customise")
    .argument("[domain]", "App domain (interactive picker if omitted)")
    .option("--suri <suri>", "Signer secret URI (e.g. //Alice for dev)")
    .action(async (rawDomain: string | undefined, opts: { suri?: string }) => {
        try {
            await withCommandTelemetry("mod", () => runModCommand(rawDomain, opts));
        } finally {
            // Same hard-exit safety net as deploy — mod opens an IPFS HTTP
            // fetch + a polkadot-api WebSocket, either of which can stay
            // ref'd past the visible work and turn the process into a
            // zombie.
            const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
            scheduleHardExit(exitCode);
        }
    });

async function runModCommand(
    rawDomain: string | undefined,
    opts: { suri?: string },
): Promise<void> {
    // Same defense-in-depth as `dot deploy`: a leaky tar/gzip stream or a
    // stuck IPFS gateway request can climb into GB territory if left
    // unattended. Cap RSS at 4 GB and force-exit cleanly otherwise.
    const stopWatchdog = startMemoryWatchdog();
    onProcessShutdown(stopWatchdog);

    let resolved: Awaited<ReturnType<typeof resolveSigner>> | null = null;

    try {
        const signer = await withSpan("cli.mod.resolve-signer", "resolve signer", {}, () =>
            resolveSigner({ suri: opts.suri }),
        );
        resolved = signer;
        const client = await withSpan("cli.mod.connection", "connect to registry chain", {}, () =>
            getConnection(),
        );
        const registry = await withSpan("cli.mod.registry", "load registry contract", {}, () =>
            getRegistryContract(client.raw.assetHub, signer),
        );

        let domain: string;
        let metadata: AppEntry | null = null;

        if (rawDomain) {
            domain = rawDomain.endsWith(".dot") ? rawDomain : `${rawDomain}.dot`;
        } else {
            const picked = await withSpan("cli.mod.browse", "browse modable apps", {}, () =>
                browseAndPick(registry),
            );
            if (!picked) {
                process.exitCode = 0;
                return;
            }
            domain = picked.domain;
            metadata = picked;
        }

        const targetDir = await withSpan(
            "cli.mod.resolve-target",
            "resolve target directory",
            {},
            () => resolveTargetDir({ domain }),
        );
        if (!targetDir) return;

        const { ok, setupRan } = await withSpan("cli.mod.setup", "download and setup mod", {}, () =>
            runSetup({
                domain,
                metadata: metadata
                    ? {
                          name: metadata.name ?? undefined,
                          description: metadata.description ?? undefined,
                          repository: metadata.repository ?? undefined,
                      }
                    : null,
                registry,
                targetDir,
            }),
        );

        console.log();
        if (ok && !setupRan) {
            console.log("  Next steps:");
            console.log(`  1. cd ${targetDir}`);
            console.log("  2. edit with claude");
            console.log("  3. dot deploy --playground");
        }
        if (!ok) process.exitCode = 1;
    } finally {
        resolved?.destroy();
        destroyConnection();
        stopWatchdog();
    }
}

async function resolveTargetDir(args: { domain: string }): Promise<string | null> {
    const fallback = defaultRepoName(args.domain);
    if (existsSync(fallback)) {
        console.error(`  Directory "${fallback}" already exists.`);
        process.exitCode = 1;
        return null;
    }
    return fallback;
}

function browseAndPick(registry: any): Promise<AppEntry | null> {
    return new Promise((resolve) => {
        const app = render(
            React.createElement(AppBrowser, {
                registry,
                modableOnly: true,
                onSelect: (selected: AppEntry) => {
                    app.unmount();
                    resolve(selected);
                },
                onCancel: () => {
                    app.unmount();
                    resolve(null);
                },
            }),
        );
    });
}

function runSetup(props: {
    domain: string;
    metadata: Record<string, string | undefined> | null;
    registry: any;
    targetDir: string;
}): Promise<{ ok: boolean; setupRan: boolean }> {
    return new Promise((resolve) => {
        const app = render(
            React.createElement(SetupScreen, {
                ...props,
                onDone: (result: { ok: boolean; setupRan: boolean }) => {
                    app.unmount();
                    resolve(result);
                },
            }),
        );
    });
}
