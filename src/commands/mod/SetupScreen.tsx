import { useRef, useState } from "react";
import { Box } from "ink";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { getGateway, fetchJson } from "@polkadot-apps/bulletin";
import { StepRunner, type Step } from "../../utils/ui/components/StepRunner.js";
import { Header, Hint, Row, Section } from "../../utils/ui/theme/index.js";
import { runCommand } from "../../utils/git.js";
import {
    downloadGitHubTarball,
    parseGitHubRepoUrl,
    resolveDefaultBranch,
} from "../../utils/mod/source.js";
import { commandExists } from "../../utils/toolchain.js";
import { VERSION_LABEL } from "../../utils/version.js";

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
    const logFile = resolve(targetDir, ".dot-mod-setup.log");

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
                const cid = metaRes.value.isSome ? metaRes.value.value : null;
                if (!cid) throw new Error(`App "${domain}" not found in registry`);

                log(`fetching metadata from IPFS (${cid.slice(0, 16)}...)...`);
                meta = await fetchJson<AppMetadata>(cid, getGateway("paseo"));
                if (!meta.repository) throw new Error("App has no repository URL");
            },
        },
        {
            name: "download source",
            run: async (log) => {
                const repoUrl = meta.repository;
                if (!repoUrl)
                    throw new Error(
                        `App "${domain}" is not modable — no source repository published.`,
                    );
                const ref = parseGitHubRepoUrl(repoUrl);
                if (!ref) {
                    throw new Error(
                        `Only GitHub-hosted source is supported for dot mod today (got ${repoUrl}).`,
                    );
                }
                const branch = meta.branch ?? (await resolveDefaultBranch(ref));
                log(`downloading github.com/${ref.owner}/${ref.repo} (${branch})…`);
                await downloadGitHubTarball({
                    owner: ref.owner,
                    repo: ref.repo,
                    branch,
                    targetDir,
                });

                if (await commandExists("git")) {
                    log("initializing fresh git history…");
                    await runCommand("git init", { cwd: targetDir, log });
                    await runCommand("git add -A", { cwd: targetDir, log });
                    await runCommand(`git commit -m "Initial commit from ${domain}"`, {
                        cwd: targetDir,
                        log,
                    });
                } else {
                    log(
                        "git not on PATH — skipping git init (mod still works, you can init later)",
                    );
                }

                stripPostinstall(targetDir);
                writeDotJson(targetDir, meta.name ?? domain.replace(/\.dot$/, ""), meta);
                ignoreModSetupLog(targetDir);
            },
        },
        {
            name: "run setup.sh",
            keepLogOnSuccess: true,
            run: async (log) => {
                if (!existsSync(resolve(targetDir, "setup.sh"))) {
                    throw new StepWarning("no setup.sh found");
                }
                await runCommand("bash setup.sh", { cwd: targetDir, log, logFile });
                setupRanRef.current = true;
                setSetupRanVisible(true);
            },
        },
    ];

    const [error, setError] = useState<string | null>(null);

    return (
        <Box flexDirection="column">
            <Header cmd="dot mod" subtitle={domain} network="paseo" right={VERSION_LABEL} />

            <StepRunner
                title={`modding ${domain}`}
                steps={steps}
                onDone={(result) => {
                    if (result.error) setError(result.error);
                    onDone({ ok: result.ok, setupRan: setupRanRef.current });
                }}
            />

            <Hint>→ {targetDir}</Hint>
            {setupRanVisible && <Hint>full setup log: {logFile}</Hint>}

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
 * Append `.dot-mod-setup.log` to the cloned repo's `.gitignore` so the per-run
 * setup log we tee for the user can't be accidentally committed. Idempotent —
 * checks for an existing entry before writing, and creates the file if it
 * doesn't yet exist.
 */
function ignoreModSetupLog(dir: string) {
    const entry = ".dot-mod-setup.log";
    const path = resolve(dir, ".gitignore");
    try {
        const existing = existsSync(path) ? readFileSync(path, "utf-8") : "";
        const lines = existing.split("\n").map((l) => l.trim());
        if (lines.includes(entry)) return;
        const prefix = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
        appendFileSync(path, `${prefix}${entry}\n`);
    } catch {
        // best-effort — if we can't write .gitignore (perms etc.) the log
        // file still works, the user just needs to ignore it manually.
    }
}

function writeDotJson(dir: string, name: string, meta: AppMetadata) {
    const dotJsonPath = resolve(dir, "dot.json");
    let dotJson: Record<string, unknown> = {};
    if (existsSync(dotJsonPath)) {
        try {
            dotJson = JSON.parse(readFileSync(dotJsonPath, "utf-8"));
        } catch {}
    }
    dotJson.domain = dir;
    dotJson.name = name;
    if (!dotJson.description && meta.description) dotJson.description = meta.description;
    if (!dotJson.tag && meta.tag) dotJson.tag = meta.tag;
    writeFileSync(dotJsonPath, JSON.stringify(dotJson, null, 2) + "\n");
}
