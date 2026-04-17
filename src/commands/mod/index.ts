import React from "react";
import { render } from "ink";
import { Command } from "commander";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolveSigner } from "../../utils/signer.js";
import { getConnection, destroyConnection } from "../../utils/connection.js";
import { getRegistryContract } from "../../utils/registry.js";
import { AppBrowser, type AppEntry } from "./AppBrowser.js";
import { SetupScreen } from "./SetupScreen.js";

export const modCommand = new Command("mod")
    .description("Fork a playground app to customize")
    .argument("[domain]", "App domain (interactive picker if omitted)")
    .option("--suri <suri>", "Signer secret URI (e.g. //Alice for dev)")
    .option("--clone", "Clone instead of forking (no GitHub fork created)")
    .option("--no-install", "Skip dependency installation")
    .action(async (rawDomain: string | undefined, opts) => {
        const resolved = await resolveSigner({ suri: opts.suri });
        const client = await getConnection();
        const registry = await getRegistryContract(client.raw.assetHub, resolved);

        try {
            // Interactive: browse and pick. Direct: use domain as-is.
            let domain: string;
            let metadata: AppEntry | null = null;

            if (rawDomain) {
                domain = rawDomain.endsWith(".dot") ? rawDomain : `${rawDomain}.dot`;
            } else {
                const picked = await browseAndPick(registry);
                domain = picked.domain;
                metadata = picked;
            }

            const targetDir =
                slugify(domain.replace(/\.dot$/, "")) + "-" + randomBytes(3).toString("hex");
            if (existsSync(targetDir)) {
                console.error(`  Directory "${targetDir}" already exists.`);
                process.exit(1);
            }

            const ok = await runSetup({
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
                forceClone: !!opts.clone,
            });

            console.log();
            if (ok) {
                console.log("  Next steps:");
                console.log(`  1. cd ${targetDir}`);
                console.log("  2. edit with claude");
                console.log("  3. dot deploy");
            }
        } finally {
            resolved.destroy();
            destroyConnection();
        }
    });

function slugify(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
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
    forceClone: boolean;
}): Promise<boolean> {
    return new Promise((resolve) => {
        const app = render(
            React.createElement(SetupScreen, {
                ...props,
                onDone: (ok: boolean) => {
                    app.unmount();
                    resolve(ok);
                },
            }),
        );
    });
}
