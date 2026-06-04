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
import { render } from "ink";
import { Command } from "commander";
import { existsSync } from "node:fs";
import { withSpan } from "../../telemetry.js";
import { getConnection, destroyConnection } from "../../utils/connection.js";
import { getReadOnlyRegistryContract } from "../../utils/registry.js";
import { AppBrowser, type AppEntry } from "./AppBrowser.js";
import { SetupScreen } from "./SetupScreen.js";
import { QuestPicker } from "./QuestPicker.js";
import { defaultRepoName } from "../../utils/git/repoName.js";
import { runCliCommand } from "../../cli-runtime.js";
import { assertPublicGitHubRepo, ModdablePreflightError } from "../../utils/deploy/moddable.js";
import { parseGitHubRepoUrl, type GitHubRepoRef } from "../../utils/mod/source.js";
import { fetchBulletinJson, getBulletinGateway } from "../../utils/bulletinGateway.js";

interface FetchedAppMetadata {
    name?: string;
    description?: string;
    repository?: string;
    branch?: string;
    tag?: string;
}

export const modCommand = new Command("mod")
    .description("Mod a playground app — clone the source as a fresh project to customise")
    .argument("[domain]", "App domain (interactive picker if omitted)")
    // --suri is retained as a no-op for backcompat. `playground mod` is fully
    // read-only on the chain side now (browse + metadata lookups go through
    // getReadOnlyRegistryContract with the keyless pallet-revive dry-run
    // origin), so there's no signer to feed.
    .option("--suri <suri>", "(deprecated, no-op) Signer secret URI")
    .action(async (rawDomain: string | undefined, _opts: { suri?: string }) =>
        runCliCommand("mod", { watchdog: true, hardExit: true }, () => runModCommand(rawDomain)),
    );

async function runModCommand(rawDomain: string | undefined): Promise<void> {
    try {
        const client = await withSpan("cli.mod.connection", "connect to registry chain", () =>
            getConnection(),
        );
        const registry = await withSpan("cli.mod.registry", "load registry contract", () =>
            getReadOnlyRegistryContract(client.raw.assetHub),
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
        // The direct-domain path (`playground mod some-domain.dot`) has no metadata
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

        // QuestPicker is a read-only display of `quests.json` from the track
        // repo's main. It runs BEFORE the existing setup flow without
        // changing any of it — when the user presses "Start tutorial" we just
        // continue into the normal clone-main path; when there's no
        // `quests.json` the picker auto-skips silently. The picker needs a
        // GitHub ref, so we lift the metadata fetch up here for the
        // direct-domain path (the interactive picker already pre-fetched).
        let repoRef: GitHubRepoRef | null = null;
        if (metadata?.repository) {
            repoRef = parseGitHubRepoUrl(metadata.repository);
        } else {
            try {
                const fetched = await withSpan(
                    "cli.mod.fetch-metadata",
                    "fetch app metadata for quest probe",
                    () => fetchAppMetadata(registry, domain),
                );
                repoRef = fetched.repository ? parseGitHubRepoUrl(fetched.repository) : null;
            } catch {
                // Fall through with `repoRef = null` — picker is skipped and
                // the existing SetupScreen step will surface the same error.
            }
        }
        if (repoRef) {
            const continued = await withSpan("cli.mod.quest-picker", "browse quests", () =>
                pickQuest(repoRef),
            );
            if (!continued) {
                process.exitCode = 0;
                return;
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
            console.log("  3. playground deploy --playground");
        }
        if (!ok) process.exitCode = 1;
    } finally {
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

async function fetchAppMetadata(registry: any, domain: string): Promise<FetchedAppMetadata> {
    const metaRes = await registry.getMetadataUri.query(domain);
    if (!metaRes.success) {
        throw new Error(
            `Registry lookup for "${domain}" failed at dry-run (chain rejected the call)`,
        );
    }
    const cid = metaRes.value.isSome ? metaRes.value.value : null;
    if (!cid) throw new Error(`App "${domain}" not found in registry`);
    return await fetchBulletinJson<FetchedAppMetadata>(cid, getBulletinGateway());
}

function pickQuest(repoRef: GitHubRepoRef): Promise<boolean> {
    return new Promise((resolve) => {
        const app = render(
            React.createElement(QuestPicker, {
                repoRef,
                onDone: () => {
                    app.unmount();
                    resolve(true);
                },
                onCancel: () => {
                    app.unmount();
                    resolve(false);
                },
            }),
        );
    });
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
