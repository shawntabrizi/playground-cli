/**
 * Filesystem + child-process I/O for `dot build`. Kept in its own module so
 * `detect.ts` can stay pure and unit-testable.
 */

import { readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { detectBuildConfig, PM_LOCKFILES, type BuildConfig, type DetectInput } from "./detect.js";

/** Files whose presence alters build strategy (read once at detect time). */
const CONFIG_PROBES = [
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mjs",
    "next.config.ts",
    "next.config.js",
    "next.config.mjs",
    "tsconfig.json",
] as const;

/** Read just enough of the project root to drive `detectBuildConfig`. */
export function loadDetectInput(projectDir: string): DetectInput {
    const root = resolve(projectDir);
    const stat = existsSync(root) ? statSync(root) : null;
    if (!stat?.isDirectory()) {
        throw new Error(`Project directory not found: ${root}`);
    }

    const pkgPath = join(root, "package.json");
    const packageJson = existsSync(pkgPath)
        ? (JSON.parse(readFileSync(pkgPath, "utf8")) as DetectInput["packageJson"])
        : null;

    const lockfiles = new Set<string>();
    for (const name of Object.values(PM_LOCKFILES)) {
        if (existsSync(join(root, name))) lockfiles.add(name);
    }

    const configFiles = new Set<string>();
    for (const name of CONFIG_PROBES) {
        if (existsSync(join(root, name))) configFiles.add(name);
    }

    return { packageJson, lockfiles, configFiles };
}

export interface RunBuildOptions {
    /** Project root. */
    cwd: string;
    /** Override the auto-detected build config. */
    config?: BuildConfig;
    /** Per-line output callback (stdout + stderr). */
    onData?: (line: string) => void;
}

export interface RunBuildResult {
    config: BuildConfig;
    /** Absolute path where the built artifacts live, according to the config. */
    outputDir: string;
}

/** Run the detected build command; reject on non-zero exit with captured output. */
export async function runBuild(options: RunBuildOptions): Promise<RunBuildResult> {
    const cwd = resolve(options.cwd);
    const config = options.config ?? detectBuildConfig(loadDetectInput(cwd));

    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(config.cmd, config.args, {
            cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
        });

        const tail: string[] = [];
        const MAX_TAIL = 50;

        const forward = (chunk: Buffer) => {
            for (const line of chunk.toString().split("\n")) {
                if (line.length === 0) continue;
                tail.push(line);
                if (tail.length > MAX_TAIL) tail.shift();
                options.onData?.(line);
            }
        };

        child.stdout.on("data", forward);
        child.stderr.on("data", forward);
        child.on("error", (err) =>
            rejectPromise(
                new Error(`Failed to spawn "${config.description}": ${err.message}`, {
                    cause: err,
                }),
            ),
        );
        child.on("close", (code) => {
            if (code === 0) {
                resolvePromise();
            } else {
                const snippet = tail.slice(-10).join("\n") || "(no output)";
                rejectPromise(
                    new Error(
                        `Build failed (${config.description}) with exit code ${code}.\n${snippet}`,
                    ),
                );
            }
        });
    });

    return {
        config,
        outputDir: resolve(cwd, config.defaultOutputDir),
    };
}
