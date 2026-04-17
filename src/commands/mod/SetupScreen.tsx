import { Box, Text } from "ink";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getGateway, fetchJson } from "@polkadot-apps/bulletin";
import { StepRunner, type Step } from "../../utils/ui/index.js";
import { isGhAuthenticated, forkAndClone, cloneRepo, runCommand } from "../../utils/git.js";

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
    forceClone: boolean;
    onDone: (ok: boolean) => void;
}

export function SetupScreen({
    domain,
    metadata: initial,
    registry,
    targetDir,
    forceClone,
    onDone,
}: Props) {
    const canFork = !forceClone && isGhAuthenticated();

    // Metadata is fetched in step 1 and shared with later steps via this ref
    let meta: AppMetadata = initial ?? {};

    const steps: Step[] = [
        {
            name: "Fetch app metadata",
            run: async (log) => {
                if (initial) {
                    log("Using cached metadata");
                    return;
                }
                log(`Querying registry for ${domain}...`);
                const metaRes = await registry.getMetadataUri.query(domain);
                const cid = metaRes.value.isSome ? metaRes.value.value : null;
                if (!cid) throw new Error(`App "${domain}" not found in registry`);

                log(`Fetching metadata from IPFS (${cid.slice(0, 16)}...)...`);
                meta = await fetchJson<AppMetadata>(cid, getGateway("paseo"));
                if (!meta.repository) throw new Error("App has no repository URL");
            },
        },
        {
            name: canFork ? "Fork & clone" : "Clone",
            run: async (log) => {
                const repo = meta.repository!;
                if (canFork) {
                    await forkAndClone(repo, targetDir, { branch: meta.branch, log });
                } else {
                    await cloneRepo(repo, targetDir, { branch: meta.branch, log });
                }
                stripPostinstall(targetDir);
                writeDotJson(targetDir, meta.name ?? domain.replace(/\.dot$/, ""), meta);
            },
        },
        {
            name: "Run setup.sh",
            run: async (log) => {
                if (!existsSync(resolve(targetDir, "setup.sh"))) {
                    throw new StepWarning("No setup.sh found");
                }
                await runCommand("bash setup.sh", { cwd: targetDir, log });
            },
        },
    ];

    return (
        <Box flexDirection="column">
            <StepRunner title={`Modding ${domain}`} steps={steps} onDone={onDone} />
            <Box marginTop={1} paddingLeft={2}>
                <Text dimColor>→ {targetDir}</Text>
            </Box>
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
