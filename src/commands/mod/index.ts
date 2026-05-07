import React from "react";
import { render } from "ink";
import { Command } from "commander";
import { existsSync } from "node:fs";
import { withSpan } from "../../telemetry.js";
import { resolveSigner } from "../../utils/signer.js";
import { getConnection, destroyConnection } from "../../utils/connection.js";
import { getRegistryContract } from "../../utils/registry.js";
import { AppBrowser, type AppEntry } from "./AppBrowser.js";
import { SetupScreen } from "./SetupScreen.js";
import { defaultRepoName } from "../../utils/git/repoName.js";
import { runCliCommand } from "../../cli-runtime.js";
import { assertPublicGitHubRepo, ModdablePreflightError } from "../../utils/deploy/moddable.js";

export const modCommand = new Command("mod")
    .description("Mod a playground app — clone the source as a fresh project to customise")
    .argument("[domain]", "App domain (interactive picker if omitted)")
    .option("--suri <suri>", "Signer secret URI (e.g. //Alice for dev)")
    .action(async (rawDomain: string | undefined, opts: { suri?: string }) =>
        runCliCommand("mod", { watchdog: true, hardExit: true }, () =>
            runModCommand(rawDomain, opts),
        ),
    );

async function runModCommand(
    rawDomain: string | undefined,
    opts: { suri?: string },
): Promise<void> {
    let resolved: Awaited<ReturnType<typeof resolveSigner>> | null = null;

    try {
        const signer = await withSpan("cli.mod.resolve-signer", "resolve signer", () =>
            resolveSigner({ suri: opts.suri }),
        );
        resolved = signer;
        const client = await withSpan("cli.mod.connection", "connect to registry chain", () =>
            getConnection(),
        );
        const registry = await withSpan("cli.mod.registry", "load registry contract", () =>
            getRegistryContract(client.raw.assetHub, signer),
        );

        let domain: string;
        let metadata: AppEntry | null = null;

        if (rawDomain) {
            domain = rawDomain.endsWith(".dot") ? rawDomain : `${rawDomain}.dot`;
        } else {
            const picked = await withSpan("cli.mod.browse", "browse moddable apps", () =>
                browseAndPick(registry),
            );
            if (!picked) {
                process.exitCode = 0;
                return;
            }
            domain = picked.domain;
            metadata = picked;
        }

        // Lazy verify that the picked app's source repository is publicly
        // reachable. The picker filters apps that have NO repository URL, but
        // a publisher can flip a repo to private after deploying, which would
        // break the anonymous codeload download a few steps down. Bail here
        // with a clean message so the user can pick a different app before we
        // mount SetupScreen and start writing files.
        //
        // The direct-domain path (`dot mod some-domain.dot`) has no metadata
        // at this point and falls through to SetupScreen, where a private or
        // missing repo surfaces as a `downloadGitHubTarball` 404 step failure.
        // Slightly less polished UX, but lifting the metadata fetch up here
        // just for symmetry would be a larger refactor.
        if (metadata?.repository) {
            const repoUrl = metadata.repository;
            try {
                await withSpan(
                    "cli.mod.repo-check",
                    "verify repository is public",
                    { "cli.mod.repo": repoUrl },
                    () => assertPublicGitHubRepo(repoUrl),
                );
            } catch (err) {
                if (err instanceof ModdablePreflightError) {
                    console.error();
                    console.error(`  ${err.message}.`);
                    console.error(
                        `  Pick a different app or ask the publisher to make the repo public.`,
                    );
                    process.exitCode = 1;
                    return;
                }
                throw err;
            }
        }

        const targetDir = await withSpan("cli.mod.resolve-target", "resolve target directory", () =>
            resolveTargetDir({ domain }),
        );
        if (!targetDir) return;

        const { ok, setupRan } = await withSpan("cli.mod.setup", "download and setup mod", () =>
            runSetup({
                domain,
                metadata: metadata
                    ? {
                          name: metadata.name ?? undefined,
                          description: metadata.description ?? undefined,
                          repository: metadata.repository ?? undefined,
                          // Carry `branch` and `tag` through so the picker path
                          // doesn't re-fetch IPFS — and, more importantly, so
                          // `meta.branch ?? "main"` in SetupScreen sees the
                          // real branch instead of falling back to a hardcoded
                          // "main" that 404s for repos with default_branch
                          // master/develop.
                          branch: metadata.branch ?? undefined,
                          tag: metadata.tag ?? undefined,
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
                moddableOnly: true,
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
