import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("telemetry disabled mode", () => {
    beforeEach(() => {
        process.env.DOT_TELEMETRY = "0";
        vi.resetModules();
    });

    it("init/flush/close are safe no-ops when disabled", async () => {
        const { initTelemetry, flushTelemetry, closeTelemetry } = await import("./telemetry.js");
        await expect(initTelemetry()).resolves.toBeUndefined();
        await expect(flushTelemetry()).resolves.toBeUndefined();
        await expect(closeTelemetry(100)).resolves.toBeUndefined();
    });

    it("withCommandTelemetry runs the callback when disabled", async () => {
        const { withCommandTelemetry } = await import("./telemetry.js");
        const result = await withCommandTelemetry("build", async () => "ok");
        expect(result).toBe("ok");
    });

    it("captureWarning and captureException are safe no-ops when disabled", async () => {
        const { captureWarning, captureException } = await import("./telemetry.js");
        expect(() => captureWarning("test warning", { path: "/Users/alice/app" })).not.toThrow();
        expect(() => captureException(new Error("boom"))).not.toThrow();
    });
});

describe("expected CLI errors", () => {
    it("classifies known user-facing failures as expected", async () => {
        const { isExpectedCliError } = await import("./telemetry.js");
        expect(isExpectedCliError('Account is not mapped in Revive. Run "dot init" first.')).toBe(
            true,
        );
        expect(isExpectedCliError("Bulletin storage allowance is exhausted")).toBe(true);
        expect(isExpectedCliError("GitHub CLI is not authenticated")).toBe(true);
        expect(isExpectedCliError('Invalid domain "bad_domain"')).toBe(true);
        expect(isExpectedCliError("No foundry/hardhat/cdm project was detected")).toBe(true);
        expect(isExpectedCliError("BadRegistryLookup: CDM registry unavailable")).toBe(true);
    });

    it("treats ambiguous runtime failures as unexpected", async () => {
        const { isExpectedCliError } = await import("./telemetry.js");
        expect(isExpectedCliError("Cannot read properties of undefined")).toBe(false);
    });
});

describe("Sentry payload sanitizers", () => {
    beforeEach(() => {
        delete process.env.CI;
        delete process.env.RUNNER_NAME;
        vi.resetModules();
    });

    it("scrubs home paths from nested error events", async () => {
        const { sanitizeSentryEvent } = await import("./telemetry.js");
        const event = sanitizeSentryEvent({
            server_name: "developer-laptop",
            message: "failed in /Users/alice/private-app",
            exception: {
                values: [
                    {
                        value: "cannot read /home/bob/secret/file.ts",
                        stacktrace: {
                            frames: [
                                {
                                    filename: "/Users/alice/private-app/src/index.ts",
                                    abs_path: "/home/bob/secret/file.ts",
                                },
                            ],
                        },
                    },
                ],
            },
            breadcrumbs: [
                {
                    message: "cwd /Users/alice/private-app",
                    data: { cwd: "/Users/alice/private-app", nested: ["/home/bob/secret"] },
                },
            ],
            extra: { path: "/Users/alice/private-app" },
        });

        expect(event.server_name).toBe("local");
        expect(JSON.stringify(event)).not.toContain("/Users/alice");
        expect(JSON.stringify(event)).not.toContain("/home/bob");
        expect(JSON.stringify(event)).toContain("/Users/<redacted>");
        expect(JSON.stringify(event)).toContain("/home/<redacted>");
    });

    it("scrubs span data in transaction events", async () => {
        const { sanitizeSentryTransaction } = await import("./telemetry.js");
        const event = sanitizeSentryTransaction({
            spans: [{ data: { cwd: "/Users/alice/private-app" } }],
            contexts: { trace: { data: { buildDir: "/home/bob/app/dist" } } },
        });

        expect(JSON.stringify(event)).not.toContain("/Users/alice");
        expect(JSON.stringify(event)).not.toContain("/home/bob");
    });
});

describe("telemetry source invariants", () => {
    it("initializes cli.sad and cli.expected to false in command root attributes", () => {
        const src = readFileSync("src/telemetry-config.ts", "utf-8");
        expect(src).toContain('"cli.sad": "false"');
        expect(src).toContain('"cli.expected": "false"');
    });

    it("withRootSpan flushes in a finally block", () => {
        const src = readFileSync("src/telemetry.ts", "utf-8");
        expect(src).toMatch(/finally\s*\{[\s\S]*await flushTelemetry\(\)/);
    });

    it("marks all command failures as sad while keeping expected errors separate", () => {
        const src = readFileSync("src/telemetry.ts", "utf-8");
        expect(src).toContain('setSpanAttribute(span, "cli.sad", "true");');
        expect(src).toContain(
            'setSpanAttribute(span, "cli.expected", expected ? "true" : "false");',
        );
        expect(src).toContain("if (!expected)");
    });
});

describe("error helpers", () => {
    beforeEach(() => {
        process.env.DOT_TELEMETRY = "0";
        vi.resetModules();
    });

    it("errorMessage handles Error and non-Error", async () => {
        const { errorMessage } = await import("./telemetry.js");
        expect(errorMessage(new Error("boom"))).toBe("boom");
        expect(errorMessage("plain")).toBe("plain");
        expect(errorMessage(undefined)).toBe("undefined");
    });

    it("sanitisedErrorMessage scrubs paths and truncates to 200 chars", async () => {
        const { sanitisedErrorMessage } = await import("./telemetry.js");
        const long = "x".repeat(500) + " /Users/alice/repo/file.ts";
        const out = sanitisedErrorMessage(new Error(long));
        expect(out.length).toBe(200);
        expect(out).not.toContain("alice");
    });
});
