import React from "react";
import { render } from "ink";
import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolveSigner } from "../../utils/signer.js";
import { getConnection, destroyConnection } from "../../utils/connection.js";
import { getRegistryContract } from "../../utils/registry.js";
import { isGhAuthenticated } from "../../utils/git.js";
import { Input } from "../../utils/ui/theme/index.js";
import { AppBrowser, type AppEntry } from "./AppBrowser.js";
import { SetupScreen } from "./SetupScreen.js";
import { defaultRepoName, validateRepoName } from "./repoName.js";

export const modCommand = new Command("mod")
    .description("Fork a playground app to customize")
    .argument("[domain]", "App domain (interactive picker if omitted)")
    .option("--suri <suri>", "Signer secret URI (e.g. //Alice for dev)")
    .option("--clone", "Clone instead of forking (no GitHub fork created)")
    .option("--no-install", "Skip dependency installation")
    .option("-y, --yes", "Skip interactive prompts (use default repo name)")
    .option("--repo-name <name>", "Repository / directory name (skips the prompt)")
    .action(
        async (
            rawDomain: string | undefined,
            opts: { suri?: string; clone?: boolean; yes?: boolean; repoName?: string },
        ) => {
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

                const canFork = !opts.clone && isGhAuthenticated();
                const targetDir = await resolveTargetDir({
                    domain,
                    canFork,
                    repoName: opts.repoName,
                    yes: !!opts.yes,
                });
                if (!targetDir) return;

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
                    canFork,
                });

                console.log();
                if (ok) {
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

/**
 * Decide the fork / local-directory name, honouring (in order): an explicit
 * `--repo-name`, a `-y` suppression of the prompt, `--clone` skipping the
 * prompt since the name is only a throwaway local dir, and otherwise an
 * interactive prompt with the auto-generated name prefilled as the default.
 * Returns `null` if a supplied name is invalid — the action logs and bails
 * in that case.
 */
async function resolveTargetDir(args: {
    domain: string;
    canFork: boolean;
    repoName: string | undefined;
    yes: boolean;
}): Promise<string | null> {
    const fallback = defaultRepoName(args.domain);

    if (args.repoName) {
        const err = validateRepoName(args.repoName);
        if (err) {
            console.error(`  ${err}`);
            process.exitCode = 1;
            return null;
        }
        return args.repoName;
    }

    // We only prompt when forking: the clone path produces a throwaway local
    // dir, so the random-suffixed default is fine and matches prior behaviour.
    if (args.yes || !args.canFork) {
        if (existsSync(fallback)) {
            console.error(`  Directory "${fallback}" already exists.`);
            process.exitCode = 1;
            return null;
        }
        return fallback;
    }

    return promptRepoName(fallback);
}

function promptRepoName(defaultName: string): Promise<string> {
    return new Promise((resolve) => {
        const app = render(
            React.createElement(Input, {
                label: "repository name",
                initial: defaultName,
                validate: validateRepoName,
                onSubmit: (name: string) => {
                    app.unmount();
                    resolve(name);
                },
            }),
        );
    });
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
    canFork: boolean;
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
