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
        expect(
            isExpectedCliError(
                "--modable: no GitHub origin configured. Create a public GitHub repository…",
            ),
        ).toBe(true);
        expect(
            isExpectedCliError(
                "modable apps must use a public GitHub repository (got: https://gitlab.com/foo/bar)",
            ),
        ).toBe(true);
        expect(
            isExpectedCliError("foo/bar is private or does not exist — modable apps must use…"),
        ).toBe(true);
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

    it("sanitizedErrorMessage scrubs paths and truncates to 200 chars", async () => {
        const { sanitizedErrorMessage } = await import("./telemetry.js");

        // Scrubbing: path within the first 200 chars must be redacted.
        const withPath = "/Users/alice/repo/file.ts failed";
        const scrubbed = sanitizedErrorMessage(new Error(withPath));
        expect(scrubbed).not.toContain("alice");
        expect(scrubbed).toContain("/Users/<redacted>");

        // Truncation: output must never exceed 200 chars.
        const long = "x".repeat(500);
        const truncated = sanitizedErrorMessage(new Error(long));
        expect(truncated.length).toBe(200);
    });
});

describe("withSpan 2-arg overload", () => {
    beforeEach(() => {
        process.env.DOT_TELEMETRY = "0";
        vi.resetModules();
    });

    it("accepts (op, name, fn) without an attributes argument", async () => {
        const { withSpan } = await import("./telemetry.js");
        const result = await withSpan("cli.test.x", "x", async () => 42);
        expect(result).toBe(42);
    });
});

describe("SAD% propagation through transaction envelope", () => {
    beforeEach(() => {
        process.env.DOT_TELEMETRY = "1";
        process.env.SENTRY_DSN = "https://abc@example.com/1";
        delete process.env.CI;
        delete process.env.RUNNER_NAME;
        vi.resetModules();
    });

    it("captures cli.sad=true on the root transaction when captureWarning fires from a child span", async () => {
        const envelopes: any[] = [];
        const fakeTransport = () => ({
            send: (envelope: any) => {
                envelopes.push(envelope);
                return Promise.resolve({ statusCode: 200 });
            },
            flush: () => Promise.resolve(true),
        });

        const {
            initTelemetry,
            withCommandTelemetry,
            withSpan,
            captureWarning,
            _resetTelemetryForTesting,
        } = await import("./telemetry.js");
        _resetTelemetryForTesting();
        await initTelemetry({ transport: fakeTransport as never });

        await withCommandTelemetry("deploy", async () => {
            await withSpan("cli.deploy.test-phase", "test-phase", async () => {
                captureWarning("Test warning", { attempt: 1 });
            });
        });

        // Each envelope is a tuple [headers, items[]]; each item is [itemHeaders, payload].
        // Find a transaction-typed item across all envelopes captured.
        let transactionPayload: any | undefined;
        for (const envelope of envelopes) {
            const items = envelope?.[1] ?? [];
            for (const item of items) {
                if (Array.isArray(item) && item[0]?.type === "transaction") {
                    transactionPayload = item[1];
                    break;
                }
            }
            if (transactionPayload) break;
        }

        expect(transactionPayload, "expected one transaction envelope item").toBeDefined();
        // Sentry surfaces root-span attributes under contexts.trace.data on transaction events.
        const traceData = transactionPayload?.contexts?.trace?.data ?? {};
        expect(traceData["cli.sad"]).toBe("true");
    });
});
