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
 * Own playground-registry publish flow.
 *
 * We upload the metadata JSON through `bulletin-deploy`'s `storeFile` (just
 * storage, NO DotNS) and then call `registry.publish(domain, metadataCid)`
 * ourselves via `getRegistryContract()`. Publishing is always signed by the
 * user so the contract's `env::caller()` matches their address — that's
 * what drives the playground-app "myApps" view.
 *
 * We deliberately do NOT use `bulletin-deploy.deploy()` for the metadata
 * upload: `deploy()` unconditionally runs a DotNS `register()` +
 * `setContenthash()` on whatever name you give it (or a randomly generated
 * `test-domain-*` when you pass `null`). That second DotNS pass is wasteful
 * and has been observed to revert with opaque contract errors. Calling
 * `storeFile` directly is the scalpel we want.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { bulletin } from "@parity/product-sdk-descriptors/bulletin";
import { calculateCid } from "@parity/product-sdk-bulletin";
import { createDevSigner, submitAndWatch, withRetry } from "@parity/product-sdk-tx";
import { getRegistryContract } from "../registry.js";
import { getConnection } from "../connection.js";
import { getChainConfig, type Env } from "../../config.js";
import { captureWarning, withSpan, errorMessage } from "../../telemetry.js";
import type { ResolvedSigner } from "../signer.js";
import type { DeployLogEvent } from "./progress.js";

/**
 * Heartbeat we force on the Bulletin WebSocket for the metadata upload.
 * `polkadot-api`'s default is 40 s, which is shorter than the time a single
 * `TransactionStorage.store` submission can take (finalization wait + chain
 * round-trips), so the transport tears down mid-tx as `WS halt (3)`.
 * Matches what `bulletin-deploy` does for its own clients. See CLAUDE.md.
 */
const BULLETIN_WS_HEARTBEAT_MS = 300_000;

const MAX_REGISTRY_RETRIES = 3;
const REGISTRY_RETRY_DELAY_MS = 6_000;

export interface PublishToPlaygroundOptions {
    /** The DotNS label (with or without `.dot`). */
    domain: string;
    /** Signer that will be recorded as the app owner in the registry. */
    publishSigner: ResolvedSigner;
    /** Repository URL to record in metadata. `null` = omit the field entirely. */
    repositoryUrl: string | null;
    /** Project root. Used to look for a `README.md` to inline into metadata. */
    cwd?: string;
    /** Progress sink for the metadata-upload sub-step. */
    onLogEvent?: (event: DeployLogEvent) => void;
    /** Target environment. */
    env?: Env;
    /**
     * If true, publish with visibility=0 (private) so the app is only visible
     * to its owner in the playground. Defaults to public (visibility=1).
     */
    isPrivate?: boolean;
}

export interface PublishToPlaygroundResult {
    /** CID of the metadata JSON on Bulletin. */
    metadataCid: string;
    /** Fully-qualified domain string recorded in the registry. */
    fullDomain: string;
    /** Effective metadata payload that got uploaded. */
    metadata: Record<string, string>;
}

/**
 * Cap on inlined README bytes. The metadata JSON is fetched once per listed
 * app in the playground feed; an unbounded README from any single publisher
 * would bloat every other user's feed load. 20 KB comfortably covers typical
 * repo READMEs and keeps a 20-app feed batch under ~400 KB.
 */
export const README_CAP_BYTES = 20 * 1024;

export type ReadmeStatus =
    | { kind: "ok"; content: string; size: number }
    | { kind: "oversized"; size: number }
    | { kind: "missing" };

/**
 * Look for a README at the project root. Returns a tagged union so callers
 * can both decide whether to inline and surface an oversize warning before
 * the user commits to deploy.
 *
 * We enumerate the directory rather than trying `README.md` verbatim so the
 * match is case-insensitive on every filesystem — macOS/Windows resolve
 * mismatched case implicitly, but Linux CI does not, and a repo with
 * `readme.md` on GitHub would otherwise be silently skipped.
 */
export function readReadme(cwd: string, capBytes = README_CAP_BYTES): ReadmeStatus {
    let entries: string[];
    try {
        entries = readdirSync(cwd);
    } catch {
        return { kind: "missing" };
    }
    const match = entries.find((name) => /^readme\.md$/i.test(name));
    if (!match) return { kind: "missing" };
    const path = join(cwd, match);
    let size: number;
    try {
        size = statSync(path).size;
    } catch {
        return { kind: "missing" };
    }
    if (size > capBytes) return { kind: "oversized", size };
    try {
        const content = readFileSync(path, "utf8");
        return { kind: "ok", content, size };
    } catch {
        return { kind: "missing" };
    }
}

/** Strip `.dot` suffix if present so we can normalize to a canonical `label.dot`. */
export function normalizeDomain(domain: string): { label: string; fullDomain: string } {
    const label = domain.replace(/\.dot$/i, "");
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(label)) {
        throw new Error(
            `Invalid domain "${domain}" — use lowercase letters, digits, and dashes (e.g. my-app.dot).`,
        );
    }
    return { label, fullDomain: `${label}.dot` };
}

/**
 * Reads the currently-checked-out branch from a git workspace.
 *
 * Returns `null` for detached HEAD or any error (no `.git`, missing `git`,
 * permission issues). Callers treat `null` as "no branch metadata to record"
 * — `dot mod` defaults to `main` for that case, which matches the GitHub
 * default-branch convention.
 */
export function readGitBranch(cwd: string): string | null {
    try {
        const out = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
            cwd,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        // `git rev-parse --abbrev-ref HEAD` returns the literal string "HEAD"
        // when in detached-HEAD state. We deliberately don't write that to
        // metadata — it would mislead `dot mod` consumers into trying to
        // download a ref called "HEAD".
        if (!out || out === "HEAD") return null;
        return out;
    } catch {
        return null;
    }
}

export function buildMetadata(input: {
    repositoryUrl: string | null;
    branch: string | null;
    readme: ReadmeStatus | null;
}): Record<string, string> {
    const meta: Record<string, string> = {};
    if (input.repositoryUrl) meta.repository = input.repositoryUrl;
    // `branch` is recorded ONLY alongside `repositoryUrl` — without a repo
    // URL the branch is meaningless, and writing it standalone would just
    // bloat the JSON.
    if (input.repositoryUrl && input.branch) meta.branch = input.branch;
    if (input.readme && input.readme.kind === "ok") meta.readme = input.readme.content;
    return meta;
}

export async function publishToPlayground(
    options: PublishToPlaygroundOptions,
): Promise<PublishToPlaygroundResult> {
    const { label, fullDomain } = normalizeDomain(options.domain);

    const readme = options.cwd ? readReadme(options.cwd) : null;
    // Persist the deploying branch alongside the repo URL so `dot mod` can
    // construct the codeload tarball URL without a separate
    // `api.github.com/repos/{o}/{r}` lookup. This eliminates one anonymous
    // GitHub API call per `dot mod` invocation — see
    // `src/commands/mod/SetupScreen.tsx`.
    const branch = options.cwd && options.repositoryUrl ? readGitBranch(options.cwd) : null;
    const metadata = buildMetadata({
        repositoryUrl: options.repositoryUrl,
        branch,
        readme,
    });

    const metadataBytes = new Uint8Array(Buffer.from(JSON.stringify(metadata), "utf8"));

    options.onLogEvent?.({ kind: "info", message: "Uploading playground metadata to Bulletin…" });
    // Storage-only upload using product-sdk Bulletin CID helpers. Submits
    // `TransactionStorage.store` directly — no DotNS, no `register()`, no
    // `setContenthash()`. The signer defaults to the Alice dev signer on
    // testnet, which is fine for a small metadata JSON.
    //
    // We spin up a DEDICATED Bulletin client with a 300 s WS heartbeat rather
    // than reusing the shared one from `getConnection()`. The shared client
    // uses polkadot-api's 40 s default which is shorter than a single-tx
    // submission and manifests as `WS halt (3)` mid-upload.
    const metadataCid = await withSpan(
        "cli.deploy.playground.metadata-upload",
        "upload playground metadata",
        { "cli.deploy.domain": fullDomain },
        async () => {
            const cfg = getChainConfig(options.env);
            const bulletinClient = createClient(
                getWsProvider([cfg.bulletinRpc, ...cfg.bulletinRpcFallbacks], {
                    heartbeatTimeout: BULLETIN_WS_HEARTBEAT_MS,
                }),
            );
            try {
                const bulletinApi = bulletinClient.getTypedApi(bulletin);
                const cid = (await calculateCid(metadataBytes)).toString();
                const signer = createDevSigner("Alice");
                await withRetry(() =>
                    submitAndWatch(
                        bulletinApi.tx.TransactionStorage.store({
                            data: metadataBytes,
                        }),
                        signer,
                    ),
                );
                return cid;
            } finally {
                bulletinClient.destroy();
            }
        },
    );
    options.onLogEvent?.({ kind: "info", message: `Metadata CID: ${metadataCid}` });

    const client = await getConnection();
    const registry = await getRegistryContract(client.raw.assetHub, options.publishSigner);

    return await withSpan(
        "cli.deploy.playground.registry-publish",
        "publish playground registry entry",
        { "cli.deploy.domain": fullDomain },
        async () => {
            let lastError: unknown;
            for (let attempt = 1; attempt <= MAX_REGISTRY_RETRIES; attempt++) {
                try {
                    const visibility = options.isPrivate ? 0 : 1;
                    const result = await registry.publish.tx(fullDomain, metadataCid, visibility);
                    if (result && result.ok === false) {
                        throw new Error("Registry publish transaction reverted");
                    }
                    return { metadataCid, fullDomain, metadata };
                } catch (err) {
                    lastError = err;
                    if (attempt >= MAX_REGISTRY_RETRIES) break;
                    captureWarning("Playground registry publish failed, retrying", {
                        attempt,
                        maxAttempts: MAX_REGISTRY_RETRIES,
                        error: errorMessage(err),
                    });
                    await new Promise((r) => setTimeout(r, REGISTRY_RETRY_DELAY_MS));
                }
            }

            const msg = lastError instanceof Error ? lastError.message : String(lastError);
            throw new Error(
                `Failed to publish to Playground registry after ${MAX_REGISTRY_RETRIES} attempts: ${msg}`,
                {
                    cause: lastError instanceof Error ? lastError : undefined,
                },
            );
        },
    );
}
