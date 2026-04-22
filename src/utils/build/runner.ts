/**
 * Filesystem + child-process I/O for `dot build`. Kept in its own module so
 * `detect.ts` can stay pure and unit-testable.
 */

import { readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { runStreamed } from "../process.js";
import {
    detectBuildConfig,
    detectInstallConfig,
    PM_LOCKFILES,
    type BuildConfig,
    type DetectInput,
    type InstallConfig,
} from "./detect.js";

/** Files whose presence alters build or contract-flow strategy (read once at detect time). */
const CONFIG_PROBES = [
    "vite.config.ts",
    "vite.config.js",
    "vite.config.mjs",
    "next.config.ts",
    "next.config.js",
    "next.config.mjs",
    "tsconfig.json",
    "foundry.toml",
    "hardhat.config.ts",
    "hardhat.config.js",
    "hardhat.config.cjs",
    "hardhat.config.mjs",
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

    const cargoPath = join(root, "Cargo.toml");
    const cargoToml = existsSync(cargoPath) ? readFileSync(cargoPath, "utf8") : null;

    return {
        packageJson,
        lockfiles,
        configFiles,
        hasNodeModules: existsSync(join(root, "node_modules")),
        cargoToml,
    };
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

/**
 * Run the detected build command. Auto-installs dependencies first when
 * node_modules/ is missing — without this, falling through to `npx <framework>
 * build` ephemerally downloads the framework binary but can't resolve the
 * project's own config-file imports. Rejects on non-zero exit with captured
 * output.
 */
export async function runBuild(options: RunBuildOptions): Promise<RunBuildResult> {
    const cwd = resolve(options.cwd);
    const input = loadDetectInput(cwd);
    const config = options.config ?? detectBuildConfig(input);

    const install: InstallConfig | null = detectInstallConfig(input);
    if (install) {
        options.onData?.(`> ${install.description}`);
        await runStreamed({
            ...install,
            cwd,
            failurePrefix: "Install failed",
            onData: options.onData,
        });
    }

    await runStreamed({
        ...config,
        cwd,
        failurePrefix: "Build failed",
        onData: options.onData,
    });

    return {
        config,
        outputDir: resolve(cwd, config.defaultOutputDir),
    };
}
