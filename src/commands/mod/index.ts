import React from "react";
import { render } from "ink";
import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolveSigner } from "../../utils/signer.js";
import { getConnection, destroyConnection } from "../../utils/connection.js";
import { getRegistryContract } from "../../utils/registry.js";
import { AppBrowser, type AppEntry } from "./AppBrowser.js";
import { SetupScreen } from "./SetupScreen.js";
import { defaultRepoName } from "../../utils/git/repoName.js";

export const modCommand = new Command("mod")
    .description("Mod a playground app — clone the source as a fresh project to customise")
    .argument("[domain]", "App domain (interactive picker if omitted)")
    .option("--suri <suri>", "Signer secret URI (e.g. //Alice for dev)")
    .action(
        async (
            rawDomain: string | undefined,
            opts: { suri?: string },
        ) => {
            const resolved = await resolveSigner({ suri: opts.suri });
            const client = await getConnection();
            const registry = await getRegistryContract(client.raw.assetHub, resolved);

            try {
                let domain: string;
                let metadata: AppEntry | null = null;

                if (rawDomain) {
                    domain = rawDomain.endsWith(".dot") ? rawDomain : `${rawDomain}.dot`;
                } else {
                    const picked = await browseAndPick(registry);
                    domain = picked.domain;
                    metadata = picked;
                }

                const targetDir = await resolveTargetDir({ domain });
                if (!targetDir) return;

                const { ok, setupRan } = await runSetup({
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
                });

                console.log();
                if (ok && !setupRan) {
                    console.log("  Next steps:");
                    console.log(`  1. cd ${targetDir}`);
                    console.log("  2. edit with claude");
                    console.log("  3. dot deploy --playground");
                }
            } finally {
                resolved.destroy();
                destroyConnection();
            }
        },
    );

async function resolveTargetDir(args: { domain: string }): Promise<string | null> {
    const fallback = defaultRepoName(args.domain);
    if (existsSync(fallback)) {
        console.error(`  Directory "${fallback}" already exists.`);
        process.exitCode = 1;
        return null;
    }
    return fallback;
}

function browseAndPick(registry: any): Promise<AppEntry> {
    return new Promise((resolve) => {
        const app = render(
            React.createElement(AppBrowser, {
                registry,
                onSelect: (selected: AppEntry) => {
                    app.unmount();
                    resolve(selected);
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
