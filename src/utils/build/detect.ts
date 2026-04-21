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

export interface InstallConfig {
    /** Binary + args to spawn. */
    cmd: string;
    args: string[];
    /** Human-readable description ("npm install", "pnpm install", …). */
    description: string;
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
    /** Whether a node_modules/ directory exists at the project root. */
    hasNodeModules: boolean;
    /** Raw Cargo.toml contents (used to gate the cdm contract flow). Null when absent. */
    cargoToml: string | null;
}

/** Kind of contract project we found at the root, or null if none. */
export type ContractsType = "foundry" | "hardhat" | "cdm";

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

const PM_INSTALL: Record<PackageManager, InstallConfig> = {
    pnpm: { cmd: "pnpm", args: ["install"], description: "pnpm install" },
    yarn: { cmd: "yarn", args: ["install"], description: "yarn install" },
    bun: { cmd: "bun", args: ["install"], description: "bun install" },
    npm: { cmd: "npm", args: ["install"], description: "npm install" },
};

/** Hardhat config file variants (TS, CJS, MJS, plain JS). */
const HARDHAT_CONFIGS = [
    "hardhat.config.ts",
    "hardhat.config.js",
    "hardhat.config.cjs",
    "hardhat.config.mjs",
] as const;

/**
 * Decide which contract-project toolchain (if any) the user is using. We only
 * gate the "deploy contracts?" prompt on this — the actual build & deploy
 * helpers re-detect at their own granularity, so a false-positive here is
 * harmless (user sees the prompt, picks "no").
 *
 * Detection rules:
 *   - foundry → `foundry.toml` at the root.
 *   - hardhat → any `hardhat.config.{ts,js,cjs,mjs}` at the root.
 *   - cdm     → `Cargo.toml` at the root that mentions `pvm_contract`
 *               (matches either snake_case or kebab-case, dep or workspace dep).
 */
export function detectContractsType(input: DetectInput): ContractsType | null {
    if (input.configFiles.has("foundry.toml")) return "foundry";
    for (const name of HARDHAT_CONFIGS) {
        if (input.configFiles.has(name)) return "hardhat";
    }
    if (input.cargoToml && /\bpvm[_-]contract\b/.test(input.cargoToml)) return "cdm";
    return null;
}

/**
 * Decide whether we need to run an install step before building. Returns the
 * install command when the project has dependencies declared but no
 * node_modules/ directory, otherwise null.
 *
 * Rationale: without this check, `dot build` for an uninstalled project falls
 * through to `npx vite build` (or similar), which ephemerally downloads the
 * framework binary but can't resolve the project's own `vite.config.ts`
 * imports — yielding a confusing ERR_MODULE_NOT_FOUND deep in the config
 * loader. Auto-installing first eliminates the footgun.
 */
export function detectInstallConfig(input: DetectInput): InstallConfig | null {
    if (input.hasNodeModules) return null;
    const pkg = input.packageJson;
    if (!pkg) return null;
    const depCount =
        Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
    if (depCount === 0) return null;
    return PM_INSTALL[detectPackageManager(input.lockfiles)];
}

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
