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

import { useRef, useState } from "react";
import { Box, Text } from "ink";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { StepRunner, type Step } from "../../utils/ui/components/StepRunner.js";
import { Header, Hint, Row, Section, Callout } from "../../utils/ui/theme/index.js";
import { COMMUNITY_NOTICE_TITLE, COMMUNITY_NOTICE_BODY } from "./communityNotice.js";
import {
    SOURCE_UNAVAILABLE_TITLE,
    sourceUnavailableBody,
    SourceUnavailableHalt,
    BROWSE_OTHER_APPS,
} from "./sourceUnavailable.js";
import { assertPublicGitHubRepo, ModdablePreflightError } from "../../utils/deploy/moddable.js";
import { runCommand } from "../../utils/git.js";
import { createOptionalGitBaseline } from "../../utils/mod/git-baseline.js";
import { downloadGitHubTarball, parseGitHubRepoUrl } from "../../utils/mod/source.js";
import { VERSION_LABEL } from "../../utils/version.js";
import { getNetworkLabel } from "../../config.js";
import { fetchBulletinJson, getBulletinGateway } from "../../utils/bulletinGateway.js";

interface AppMetadata {
    name?: string;
    description?: string;
    repository?: string;
    branch?: string;
    tag?: string;
}

interface Props {
    domain: string;
    /** Pre-fetched metadata (interactive path) or null (direct path — will fetch). */
    metadata: AppMetadata | null;
    registry: any;
    targetDir: string;
    onDone: (result: { ok: boolean; setupRan: boolean }) => void;
}

export function SetupScreen({ domain, metadata: initial, registry, targetDir, onDone }: Props) {
    // Metadata is fetched in step 1 and shared with later steps via this ref
    let meta: AppMetadata = initial ?? {};
    // Tracks whether `setup.sh` actually ran to completion in this session.
    // Used by the parent to decide whether to print the generic "Next steps"
    // fallback footer (only when there was no script-provided footer).
    // Lives in a ref because StepRunner captures `onDone` once on mount —
    // a useState value would be stale by the time the runner reports back.
    // The matching `Hint` is driven off the state setter for re-render.
    const setupRanRef = useRef(false);
    const [setupRanVisible, setSetupRanVisible] = useState(false);
    // Set when the app's GitHub source is no longer publicly reachable. Swaps
    // the red "setup failed" row for a gentle yellow notice (see
    // sourceUnavailable.ts) — the publisher made the repo private/deleted it
    // after publishing, which we can't undo and the user can't fix.
    const [unavailable, setUnavailable] = useState(false);
    const setupLogFile = resolve(targetDir, ".dot-mod-setup.log");
    const sourceLogFile = resolve(targetDir, ".dot-mod-source.log");

    const steps: Step[] = [
        {
            name: "fetch app metadata",
            run: async (log) => {
                if (initial) {
                    log("using cached metadata");
                    return;
                }
                log(`querying registry for ${domain}...`);
                const metaRes = await registry.getMetadataUri.query(domain);
                if (!metaRes.success) {
                    throw new Error(
                        `Registry lookup for "${domain}" failed at dry-run (chain rejected the call).`,
                    );
                }
                const cid = metaRes.value.isSome ? metaRes.value.value : null;
                if (!cid) throw new Error(`App "${domain}" not found in registry`);

                log(`fetching metadata from IPFS (${cid.slice(0, 16)}...)...`);
                meta = await fetchBulletinJson<AppMetadata>(cid, getBulletinGateway());
                if (!meta.repository) throw new Error("App has no repository URL");
            },
        },
        {
            name: "download source",
            run: async (log) => {
                const repoUrl = meta.repository;
                if (!repoUrl)
                    throw new Error(
                        `App "${domain}" is not moddable — no source repository published.`,
                    );
                const ref = parseGitHubRepoUrl(repoUrl);
                if (!ref) {
                    throw new Error(
                        `Only GitHub-hosted source is supported for playground mod today (got ${repoUrl}).`,
                    );
                }
                // `meta.branch` is written by `dot deploy --moddable` from
                // `git rev-parse --abbrev-ref HEAD` at deploy time. The "main"
                // fallback handles the rare case of an old deploy that
                // pre-dates the metadata field — codeload returns 404 for a
                // wrong branch, which surfaces as a clear download error.
                // The repository URL is frozen into the app metadata at deploy
                // time; the publisher may since have made the repo private,
                // deleted, or renamed it. Probe before the codeload download so
                // we can present that gently instead of a raw 404 step failure.
                // (The interactive picker pre-checks too, but a direct
                // `playground mod <domain>` lands here without that guard.)
                try {
                    await assertPublicGitHubRepo(repoUrl);
                } catch (err) {
                    if (err instanceof ModdablePreflightError) {
                        setUnavailable(true);
                        throw new SourceUnavailableHalt("source no longer publicly available");
                    }
                    // Transient/non-404 verification error — fall through and
                    // let the download below surface the real failure.
                }
                const branch = meta.branch ?? "main";
                log(`downloading github.com/${ref.owner}/${ref.repo} (${branch})…`);
                await downloadGitHubTarball({
                    owner: ref.owner,
                    repo: ref.repo,
                    branch,
                    targetDir,
                });

                await createOptionalGitBaseline(targetDir, log, sourceLogFile);

                stripPostinstall(targetDir);
                writeDotJson(targetDir, meta.name ?? domain.replace(/\.dot$/, ""), meta, domain);
                ignoreModLogs(targetDir);
            },
        },
        {
            name: "run setup.sh",
            keepLogOnSuccess: true,
            run: async (log) => {
                if (!existsSync(resolve(targetDir, "setup.sh"))) {
                    throw new StepWarning("no setup.sh found");
                }
                await runCommand("bash setup.sh", { cwd: targetDir, log, logFile: setupLogFile });
                setupRanRef.current = true;
                setSetupRanVisible(true);
            },
        },
    ];

    const [error, setError] = useState<string | null>(null);

    return (
        <Box flexDirection="column">
            <Header
                cmd="playground mod"
                subtitle={domain}
                network={getNetworkLabel()}
                right={VERSION_LABEL}
            />

            {/* The interactive picker already showed this notice above the
                app list; only the direct `playground mod <domain>` path
                (no pre-fetched metadata) needs it here. */}
            {initial === null && (
                <Callout tone="warning" title={COMMUNITY_NOTICE_TITLE}>
                    <Text>{COMMUNITY_NOTICE_BODY}</Text>
                </Callout>
            )}

            <StepRunner
                title={`modding ${domain}`}
                steps={steps}
                onDone={(result) => {
                    if (result.error) setError(result.error);
                    onDone({ ok: result.ok, setupRan: setupRanRef.current });
                }}
            />

            {!unavailable && <Hint>→ {targetDir}</Hint>}
            {setupRanVisible && <Hint>full setup log: {setupLogFile}</Hint>}

            {unavailable && (
                <Callout tone="warning" title={SOURCE_UNAVAILABLE_TITLE}>
                    <Text>{sourceUnavailableBody(domain, BROWSE_OTHER_APPS)}</Text>
                </Callout>
            )}

            {error && (
                <Section>
                    <Row mark="fail" label="setup failed" value={error} tone="danger" />
                </Section>
            )}
        </Box>
    );
}

class StepWarning extends Error {
    isWarning = true;
    constructor(message: string) {
        super(message);
    }
}

function stripPostinstall(dir: string) {
    const pkgPath = resolve(dir, "package.json");
    if (!existsSync(pkgPath)) return;
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.scripts?.postinstall) {
            delete pkg.scripts.postinstall;
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
        }
    } catch {}
}

/**
 * Append dot mod logs to the cloned repo's `.gitignore` so the per-run
 * setup log we tee for the user can't be accidentally committed. Idempotent —
 * checks for an existing entry before writing, and creates the file if it
 * doesn't yet exist.
 */
function ignoreModLogs(dir: string) {
    const entries = [".dot-mod-setup.log", ".dot-mod-source.log"];
    const path = resolve(dir, ".gitignore");
    try {
        const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
        const lines = existing.split("\n").map((l) => l.trim());
        const missing = entries.filter((entry) => !lines.includes(entry));
        if (missing.length === 0) return;
        const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
        appendFileSync(path, `${prefix}${missing.join("\n")}\n`);
    } catch {
        // best-effort — if we can't write .gitignore (perms etc.) the logs
        // still work, the user just needs to ignore them manually.
    }
}

function writeDotJson(dir: string, name: string, meta: AppMetadata, sourceDomain: string) {
    const dotJsonPath = resolve(dir, "dot.json");
    let dotJson: Record<string, unknown> = {};
    if (existsSync(dotJsonPath)) {
        try {
            dotJson = JSON.parse(readFileSync(dotJsonPath, "utf-8"));
        } catch {}
    }
    dotJson.domain = dir;
    dotJson.name = name;
    dotJson.moddedFrom = sourceDomain;
    if (!dotJson.description && meta.description) dotJson.description = meta.description;
    if (!dotJson.tag && meta.tag) dotJson.tag = meta.tag;
    writeFileSync(dotJsonPath, JSON.stringify(dotJson, null, 2) + "\n");
}
