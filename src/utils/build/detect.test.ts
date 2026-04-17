import { describe, it, expect } from "vitest";
import {
    detectBuildConfig,
    detectPackageManager,
    BuildDetectError,
    type DetectInput,
} from "./detect.js";

function input(overrides: Partial<DetectInput> = {}): DetectInput {
    return {
        packageJson: null,
        lockfiles: new Set(),
        configFiles: new Set(),
        ...overrides,
    };
}

describe("detectPackageManager", () => {
    it("defaults to npm when no lockfile is present", () => {
        expect(detectPackageManager(new Set())).toBe("npm");
    });

    it("picks pnpm over yarn when both lockfiles are present", () => {
        // Mixed lockfiles happen in practice during migrations; we pick the one
        // most likely to be currently maintained.
        expect(detectPackageManager(new Set(["pnpm-lock.yaml", "yarn.lock"]))).toBe("pnpm");
    });

    it("picks yarn when only yarn.lock is present", () => {
        expect(detectPackageManager(new Set(["yarn.lock"]))).toBe("yarn");
    });

    it("picks bun when only bun.lockb is present", () => {
        expect(detectPackageManager(new Set(["bun.lockb"]))).toBe("bun");
    });
});

describe("detectBuildConfig", () => {
    it("prefers an explicit build script via the detected PM", () => {
        const cfg = detectBuildConfig(
            input({
                packageJson: { scripts: { build: "vite build" } },
                lockfiles: new Set(["pnpm-lock.yaml"]),
            }),
        );
        expect(cfg.cmd).toBe("pnpm");
        expect(cfg.args).toEqual(["run", "build"]);
        expect(cfg.description).toBe("pnpm run build");
        expect(cfg.defaultOutputDir).toBe("dist");
    });

    it("passes npm even without any lockfile", () => {
        const cfg = detectBuildConfig(
            input({
                packageJson: { scripts: { build: "tsc" } },
            }),
        );
        expect(cfg.cmd).toBe("npm");
        expect(cfg.defaultOutputDir).toBe("dist");
    });

    it("infers .next output dir when the build script invokes next", () => {
        const cfg = detectBuildConfig(
            input({
                packageJson: { scripts: { build: "next build" } },
                lockfiles: new Set(["yarn.lock"]),
            }),
        );
        expect(cfg.defaultOutputDir).toBe(".next");
        expect(cfg.cmd).toBe("yarn");
    });

    it("falls back to vite exec when only vite.config.ts is present", () => {
        const cfg = detectBuildConfig(
            input({
                packageJson: { dependencies: { vite: "^5.0.0" } },
                lockfiles: new Set(["bun.lockb"]),
                configFiles: new Set(["vite.config.ts"]),
            }),
        );
        expect(cfg.cmd).toBe("bunx");
        expect(cfg.args).toEqual(["vite", "build"]);
        expect(cfg.description).toBe("bun exec vite build");
        expect(cfg.defaultOutputDir).toBe("dist");
    });

    it("falls back to next exec when only next.config.js is present", () => {
        const cfg = detectBuildConfig(
            input({
                packageJson: { devDependencies: { next: "^14.0.0" } },
                lockfiles: new Set(["pnpm-lock.yaml"]),
                configFiles: new Set(["next.config.js"]),
            }),
        );
        expect(cfg.cmd).toBe("pnpm");
        expect(cfg.args).toEqual(["exec", "next", "build"]);
        expect(cfg.defaultOutputDir).toBe(".next");
    });

    it("falls back to tsc when typescript + tsconfig.json are present", () => {
        const cfg = detectBuildConfig(
            input({
                packageJson: { devDependencies: { typescript: "^5.0.0" } },
                configFiles: new Set(["tsconfig.json"]),
            }),
        );
        expect(cfg.cmd).toBe("npx");
        expect(cfg.args).toEqual(["tsc", "-p", "tsconfig.json"]);
    });

    it("throws BuildDetectError when no strategy matches", () => {
        expect(() => detectBuildConfig(input({ packageJson: { scripts: {} } }))).toThrow(
            BuildDetectError,
        );
    });

    it("throws when typescript is installed but tsconfig.json is missing", () => {
        // tsc without a tsconfig is almost certainly not what the user wants —
        // prefer the clear error over guessing.
        expect(() =>
            detectBuildConfig(
                input({
                    packageJson: { devDependencies: { typescript: "^5.0.0" } },
                }),
            ),
        ).toThrow(BuildDetectError);
    });
});
