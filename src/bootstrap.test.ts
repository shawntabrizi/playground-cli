import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("bootstrap", () => {
    beforeEach(() => {
        delete process.env.DOT_TELEMETRY;
        delete process.env.GITHUB_REPOSITORY;
        delete process.env.RUNNER_NAME;
        delete process.env.BULLETIN_DEPLOY_USE_AMBIENT_SENTRY;
        delete process.env.BULLETIN_DEPLOY_HOST_APP;
        delete process.env.BULLETIN_DEPLOY_TELEMETRY;
        delete process.env.BULLETIN_DEPLOY_MEM_REPORT;
        vi.resetModules();
    });

    it("sets bulletin-deploy ambient Sentry mode when unset", async () => {
        await import("./bootstrap.js");
        expect(process.env.BULLETIN_DEPLOY_USE_AMBIENT_SENTRY).toBe("1");
        expect(process.env.BULLETIN_DEPLOY_HOST_APP).toBe("playground-cli");
    });

    it("disables bulletin-deploy telemetry for unknown external users", async () => {
        const cwd = process.cwd();
        const dir = mkdtempSync(join(tmpdir(), "dot-bootstrap-"));
        try {
            process.chdir(dir);
            await import("./bootstrap.js");
            expect(process.env.BULLETIN_DEPLOY_TELEMETRY).toBe("0");
        } finally {
            process.chdir(cwd);
        }
    });

    it("enables bulletin-deploy telemetry when DOT_TELEMETRY=1", async () => {
        process.env.DOT_TELEMETRY = "1";
        await import("./bootstrap.js");
        expect(process.env.BULLETIN_DEPLOY_TELEMETRY).toBe("1");
    });

    it("enables bulletin-deploy telemetry in internal CI contexts", async () => {
        process.env.GITHUB_REPOSITORY = "paritytech/playground-cli";
        await import("./bootstrap.js");
        expect(process.env.BULLETIN_DEPLOY_TELEMETRY).toBe("1");
    });

    it("preserves explicit bulletin-deploy env overrides", async () => {
        process.env.BULLETIN_DEPLOY_USE_AMBIENT_SENTRY = "0";
        process.env.BULLETIN_DEPLOY_HOST_APP = "custom";
        process.env.BULLETIN_DEPLOY_TELEMETRY = "0";
        process.env.BULLETIN_DEPLOY_MEM_REPORT = "0";
        process.env.DOT_TELEMETRY = "1";

        await import("./bootstrap.js");

        expect(process.env.BULLETIN_DEPLOY_USE_AMBIENT_SENTRY).toBe("0");
        expect(process.env.BULLETIN_DEPLOY_HOST_APP).toBe("custom");
        expect(process.env.BULLETIN_DEPLOY_TELEMETRY).toBe("0");
        expect(process.env.BULLETIN_DEPLOY_MEM_REPORT).toBe("0");
    });

    it("does not force BULLETIN_DEPLOY_MEM_REPORT=0 by default", async () => {
        await import("./bootstrap.js");
        expect(process.env.BULLETIN_DEPLOY_MEM_REPORT).toBeUndefined();
    });

    // Load-bearing structural invariant: if bootstrap stops being the first
    // import of `src/index.ts`, the bulletin-deploy import chain will evaluate
    // its `DISABLED` gate before our env vars are set — which is the exact bug
    // this module exists to prevent. A Biome reorder / careless rebase could
    // silently break the fix; this test nails the ordering down.
    it("is the first import in src/index.ts", () => {
        const src = readFileSync("src/index.ts", "utf-8");
        const firstImport = src.match(/^import\s+(?:[^;]+\s+from\s+)?["']([^"']+)["'];?$/m);
        expect(firstImport?.[1]).toBe("./bootstrap.js");
    });
});
