import { Command } from "commander";
import {
    chmodSync,
    closeSync,
    fsyncSync,
    mkdirSync,
    openSync,
    renameSync,
    unlinkSync,
    writeFileSync,
    writeSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { arch, platform } from "node:os";
import { resolve } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { withSpan, errorMessage } from "../telemetry.js";
import { runCliCommand } from "../cli-runtime.js";

const REPO = "paritytech/playground-cli";
const JSDELIVR_RESOLVED_URL = `https://data.jsdelivr.com/v1/packages/gh/${REPO}/resolved`;

export function resolveInstallDir(env: NodeJS.ProcessEnv = process.env): string {
    const home = env.HOME;
    if (!home) {
        throw new Error(
            "HOME is not set — cannot determine install location. Run with HOME=<your home directory>.",
        );
    }
    return resolve(home, ".polkadot", "bin");
}

type Os = "darwin" | "linux";
type Cpu = "arm64" | "x64";

export function detectAsset(os: Os = platform() as Os, cpu: Cpu = arch() as Cpu): string {
    const normalisedOs: Os = os === "darwin" ? "darwin" : "linux";
    const normalisedCpu: Cpu = cpu === "arm64" ? "arm64" : "x64";
    return `dot-${normalisedOs}-${normalisedCpu}`;
}

export async function fetchLatestTag(fetchImpl: typeof fetch = fetch): Promise<string> {
    // Resolve through jsDelivr's free public CDN rather than
    // `api.github.com` so this call NEVER consumes the 60/hour anonymous-IP
    // GitHub API quota — it would have been ironic for the very command
    // that downloads the new binary to itself be denied on hackathon WiFi.
    // jsDelivr returns `{ "version": "0.17.0" }` (no `v` prefix); we add
    // it so the rest of `update.ts` keeps comparing tags consistently with
    // `package.json`'s `vX.Y.Z` convention.
    const res = await fetchImpl(JSDELIVR_RESOLVED_URL, {
        headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`jsDelivr returned ${res.status}`);
    const data = (await res.json()) as { version?: string };
    if (!data.version) throw new Error("Could not determine latest release");
    return data.version.startsWith("v") ? data.version : `v${data.version}`;
}

async function downloadBinary(
    tag: string,
    asset: string,
    fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
    const url = `https://github.com/${REPO}/releases/download/${tag}/${asset}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
}

/**
 * Atomically install `bytes` to `dest`.
 *
 * Writes to a sibling `${dest}.new` file, fsyncs, then renames into place.
 * This is safe to run even when `dest` is the currently executing binary —
 * the running process keeps its open file descriptor on the old inode while
 * new invocations see the new one. Falls back to direct write if the atomic
 * path fails (e.g. different filesystems, read-only parent).
 */
export function atomicInstall(dest: string, bytes: Buffer, mode = 0o755): void {
    const staging = `${dest}.new`;
    try {
        const fd = openSync(staging, "w", mode);
        try {
            writeSync(fd, bytes);
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }
        chmodSync(staging, mode);
        renameSync(staging, dest);
    } catch (err) {
        // Clean up a half-written staging file before falling through.
        try {
            unlinkSync(staging);
        } catch {
            // ignore — may not exist
        }
        // Fall back to direct overwrite (previous behaviour). Still better
        // than leaving the user with no installed binary.
        writeFileSync(dest, bytes);
        chmodSync(dest, mode);
        // Re-throw is not what we want here — the direct write succeeded.
        // But propagate the original error detail in a warning.
        console.warn(
            `Atomic install failed, wrote directly: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}

export const updateCommand = new Command("update")
    .description("Update dot to the latest version")
    .action(async () =>
        runCliCommand("update", { hardExit: true }, async () => {
            const installDir = await withSpan(
                "cli.update.resolve-install-dir",
                "resolve install dir",
                () => resolveInstallDir(),
            );

            const current = `v${pkg.version}`;
            process.stdout.write("Checking for updates... ");

            let tag: string;
            try {
                tag = await withSpan("cli.update.fetch-latest", "fetch latest release", () =>
                    fetchLatestTag(),
                );
            } catch (err) {
                console.log("failed");
                console.error(`Could not check for updates: ${errorMessage(err)}`);
                process.exitCode = 1;
                throw err;
            }

            if (tag === current) {
                console.log(`already on latest (${current})`);
                return;
            }

            console.log(`${current} → ${tag}`);
            process.stdout.write("Downloading... ");

            const asset = detectAsset();
            let binary: Buffer;
            try {
                binary = await withSpan(
                    "cli.update.download",
                    "download release asset",
                    { "cli.update.asset": asset },
                    () => downloadBinary(tag, asset),
                );
            } catch (err) {
                console.log("failed");
                console.error(errorMessage(err));
                process.exitCode = 1;
                throw err;
            }

            const dest = resolve(installDir, "dot");
            try {
                await withSpan(
                    "cli.update.install",
                    "install update",
                    { "cli.update.asset": asset },
                    async () => {
                        mkdirSync(installDir, { recursive: true });
                        atomicInstall(dest, binary);

                        if (platform() === "darwin") {
                            // Re-sign so Gatekeeper doesn't quarantine the fresh binary.
                            // Both calls are best-effort — an unsigned binary still runs.
                            try {
                                execSync(`codesign --sign - --force "${dest}"`, {
                                    stdio: "ignore",
                                });
                            } catch {}
                            try {
                                execSync(`xattr -c "${dest}"`, { stdio: "ignore" });
                            } catch {}
                        }
                    },
                );
            } catch (err) {
                console.log("failed");
                console.error(`Could not write to ${dest}: ${errorMessage(err)}`);
                process.exitCode = 1;
                throw err;
            }

            console.log("done");
            console.log(`Updated dot to ${tag}`);
        }),
    );
