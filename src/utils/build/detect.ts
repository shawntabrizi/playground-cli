/**
 * Pure build-config detection — given a project tree snapshot, decide which
 * command to run and where the output will land. No I/O here so unit tests
 * stay trivial; the caller is responsible for reading package.json and
 * listing lockfiles.
 */

import { DEFAULT_BUILD_DIR } from "../../config.js";

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

/** Files we inspect on disk to infer the package manager. */
export const PM_LOCKFILES: Record<PackageManager, string> = {
    pnpm: "pnpm-lock.yaml",
    yarn: "yarn.lock",
    bun: "bun.lockb",
    npm: "package-lock.json",
};

export interface BuildConfig {
    /** Binary + args to spawn. */
    cmd: string;
    args: string[];
    /** Human-readable description of which route we took ("pnpm run build", "npx vite build", …). */
    description: string;
    /** Best guess at where the built artifacts will land, relative to the project root. */
    defaultOutputDir: string;
}

export interface DetectInput {
    /** Parsed package.json contents (object after JSON.parse), or null if missing. */
    packageJson: {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    } | null;
    /** Set of lockfile basenames that exist in the project root. */
    lockfiles: Set<string>;
    /** Set of additional config-file basenames (e.g. vite.config.ts). */
    configFiles: Set<string>;
}

export class BuildDetectError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BuildDetectError";
    }
}

/** Pick a package manager from the lockfiles present. Defaults to npm. */
export function detectPackageManager(lockfiles: Set<string>): PackageManager {
    if (lockfiles.has(PM_LOCKFILES.pnpm)) return "pnpm";
    if (lockfiles.has(PM_LOCKFILES.yarn)) return "yarn";
    if (lockfiles.has(PM_LOCKFILES.bun)) return "bun";
    return "npm";
}

/** Frameworks we can invoke directly (via the PM's exec runner) if no `build` script is defined. */
const FRAMEWORK_HINTS: Array<{
    name: string;
    matches: (input: DetectInput) => boolean;
    /** Command forwarded to the PM's `exec` / `dlx` runner. */
    execCommand: string[];
    defaultOutputDir: string;
}> = [
    {
        name: "vite",
        matches: (i) =>
            i.configFiles.has("vite.config.ts") ||
            i.configFiles.has("vite.config.js") ||
            i.configFiles.has("vite.config.mjs") ||
            hasDep(i.packageJson, "vite"),
        execCommand: ["vite", "build"],
        defaultOutputDir: "dist",
    },
    {
        name: "next",
        matches: (i) =>
            i.configFiles.has("next.config.js") ||
            i.configFiles.has("next.config.mjs") ||
            i.configFiles.has("next.config.ts") ||
            hasDep(i.packageJson, "next"),
        execCommand: ["next", "build"],
        defaultOutputDir: ".next",
    },
    {
        name: "tsc",
        matches: (i) => i.configFiles.has("tsconfig.json") && hasDep(i.packageJson, "typescript"),
        execCommand: ["tsc", "-p", "tsconfig.json"],
        defaultOutputDir: DEFAULT_BUILD_DIR,
    },
];

function hasDep(pkg: DetectInput["packageJson"], name: string): boolean {
    if (!pkg) return false;
    return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

const PM_RUN: Record<PackageManager, string[]> = {
    pnpm: ["pnpm", "run"],
    yarn: ["yarn", "run"],
    bun: ["bun", "run"],
    npm: ["npm", "run"],
};

const PM_EXEC: Record<PackageManager, string[]> = {
    pnpm: ["pnpm", "exec"],
    yarn: ["yarn"],
    bun: ["bunx"],
    npm: ["npx"],
};

/**
 * Pick a build command given the detected project state.
 *
 * Preference order:
 *   1. An explicit `build` npm script, invoked through the detected PM.
 *   2. A known framework (vite / next / tsc), invoked through the PM's exec runner.
 *   3. Throw — we don't know how to build.
 */
export function detectBuildConfig(input: DetectInput): BuildConfig {
    const pm = detectPackageManager(input.lockfiles);
    const buildScript = input.packageJson?.scripts?.build;

    if (buildScript) {
        const [cmd, ...args] = PM_RUN[pm];
        return {
            cmd,
            args: [...args, "build"],
            description: `${pm} run build`,
            defaultOutputDir: inferOutputDirFromScript(buildScript) ?? DEFAULT_BUILD_DIR,
        };
    }

    for (const hint of FRAMEWORK_HINTS) {
        if (hint.matches(input)) {
            const [cmd, ...args] = PM_EXEC[pm];
            return {
                cmd,
                args: [...args, ...hint.execCommand],
                description: `${pm} exec ${hint.execCommand.join(" ")}`,
                defaultOutputDir: hint.defaultOutputDir,
            };
        }
    }

    throw new BuildDetectError(
        'No build strategy detected. Add a "build" script to package.json, or install vite/next/typescript.',
    );
}

/** Cheap heuristic: if the build script mentions a known tool, guess its default output dir. */
function inferOutputDirFromScript(script: string): string | null {
    if (/\bnext\b/.test(script)) return ".next";
    if (/\bvite\b/.test(script)) return "dist";
    if (/\btsc\b/.test(script)) return DEFAULT_BUILD_DIR;
    return null;
}
