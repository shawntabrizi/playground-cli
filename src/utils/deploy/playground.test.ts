import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { captureWarningMock, withSpanMock } = vi.hoisted(() => ({
    captureWarningMock: vi.fn(),
    withSpanMock: vi.fn(async (_op: string, _name: string, _attrs: any, fn: any) => fn()),
}));

// Mock the metadata upload path so we never actually touch the network.
// The mock returns a fake CID that publish() treats as the metadata CID.
vi.mock("@polkadot-apps/bulletin", () => ({
    upload: vi.fn(async () => ({ cid: "bafymeta", blockHash: "0x0" })),
}));
vi.mock("polkadot-api", () => ({
    createClient: vi.fn(() => ({
        getTypedApi: vi.fn(() => ({})),
        destroy: vi.fn(),
    })),
}));
vi.mock("polkadot-api/ws-provider/web", () => ({
    getWsProvider: vi.fn(() => ({})),
}));
vi.mock("polkadot-api/polkadot-sdk-compat", () => ({
    withPolkadotSdkCompat: vi.fn((provider) => provider),
}));

// Likewise stub the connection + registry helpers. We capture the publish
// arguments so we can assert on them.
const publishTx = vi.fn(async () => ({ ok: true, txHash: "0xdead" }));
vi.mock("../connection.js", () => ({
    getConnection: vi.fn(async () => ({ raw: { assetHub: {} } })),
}));
vi.mock("../registry.js", () => ({
    getRegistryContract: vi.fn(async () => ({
        publish: { tx: publishTx },
    })),
}));
vi.mock("../../telemetry.js", () => ({
    captureWarning: (...args: unknown[]) => captureWarningMock(...args),
    withSpan: (...args: unknown[]) =>
        withSpanMock(args[0] as string, args[1] as string, args[2], args[3]),
    errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

import {
    publishToPlayground,
    buildMetadata,
    normalizeDomain,
    readReadme,
    README_CAP_BYTES,
} from "./playground.js";
import type { ResolvedSigner } from "../signer.js";

const makeTmpDir = () => mkdtempSync(join(tmpdir(), "dot-playground-test-"));

const fakeSigner: ResolvedSigner = {
    signer: {} as any,
    address: "5Fake",
    source: "session",
    destroy: () => {},
};

beforeEach(() => {
    publishTx.mockClear();
    publishTx.mockImplementation(async () => ({ ok: true, txHash: "0xdead" }));
    captureWarningMock.mockClear();
    withSpanMock.mockClear();
});

describe("normalizeDomain", () => {
    it("accepts a bare label", () => {
        expect(normalizeDomain("my-app")).toEqual({ label: "my-app", fullDomain: "my-app.dot" });
    });

    it("accepts a label with .dot suffix", () => {
        expect(normalizeDomain("my-app.dot")).toEqual({
            label: "my-app",
            fullDomain: "my-app.dot",
        });
    });

    it("rejects invalid characters", () => {
        expect(() => normalizeDomain("My_App!")).toThrow(/Invalid domain/);
    });
});

describe("readReadme", () => {
    it("returns content when README.md exists and fits under the cap", () => {
        const dir = makeTmpDir();
        try {
            writeFileSync(join(dir, "README.md"), "# My App\n\nHello there.");
            const status = readReadme(dir);
            expect(status.kind).toBe("ok");
            if (status.kind === "ok") {
                expect(status.content).toBe("# My App\n\nHello there.");
                expect(status.size).toBe(Buffer.byteLength(status.content, "utf8"));
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("reports oversized when README.md exceeds the cap", () => {
        const dir = makeTmpDir();
        try {
            // One byte over the default 20 KB cap.
            const bigContent = "x".repeat(README_CAP_BYTES + 1);
            writeFileSync(join(dir, "README.md"), bigContent);
            const status = readReadme(dir);
            expect(status.kind).toBe("oversized");
            if (status.kind === "oversized") {
                expect(status.size).toBe(README_CAP_BYTES + 1);
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("returns missing when the file is not present", () => {
        const dir = makeTmpDir();
        try {
            const status = readReadme(dir);
            expect(status.kind).toBe("missing");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("falls back to lowercase readme.md on case-sensitive filesystems", () => {
        const dir = makeTmpDir();
        try {
            writeFileSync(join(dir, "readme.md"), "# lower");
            const status = readReadme(dir);
            expect(status.kind).toBe("ok");
            if (status.kind === "ok") expect(status.content).toBe("# lower");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("falls back to title-cased Readme.md", () => {
        const dir = makeTmpDir();
        try {
            writeFileSync(join(dir, "Readme.md"), "# title");
            const status = readReadme(dir);
            expect(status.kind).toBe("ok");
            if (status.kind === "ok") expect(status.content).toBe("# title");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("respects a custom cap", () => {
        const dir = makeTmpDir();
        try {
            writeFileSync(join(dir, "README.md"), "abcdefghij"); // 10 bytes
            expect(readReadme(dir, 5).kind).toBe("oversized");
            expect(readReadme(dir, 10).kind).toBe("ok");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe("buildMetadata", () => {
    it("includes repository when repositoryUrl is non-null", () => {
        const meta = buildMetadata({ repositoryUrl: "https://github.com/x/y", readme: null });
        expect(meta).toEqual({ repository: "https://github.com/x/y" });
    });

    it("omits repository entirely when repositoryUrl is null", () => {
        const meta = buildMetadata({ repositoryUrl: null, readme: null });
        expect(meta.repository).toBeUndefined();
    });

    it("includes README when present", () => {
        const meta = buildMetadata({
            repositoryUrl: null,
            readme: { kind: "ok", content: "hello", size: 5 },
        });
        expect(meta).toEqual({ readme: "hello" });
    });
});

describe("publishToPlayground", () => {
    // Every test needs a cwd that doesn't accidentally pick up the repo's own
    // README.md (the CLI's real README is ~10 KB and would be inlined if we
    // defaulted to `process.cwd()`). Each test opts into a tmpdir explicitly.
    it("uploads metadata JSON and calls registry.publish with the phone signer", async () => {
        const dir = makeTmpDir();
        try {
            const result = await publishToPlayground({
                domain: "my-app",
                publishSigner: fakeSigner,
                repositoryUrl: "https://github.com/paritytech/example",
                cwd: dir,
            });

            expect(result.fullDomain).toBe("my-app.dot");
            expect(result.metadata).toEqual({
                repository: "https://github.com/paritytech/example",
            });
            expect(result.metadataCid).toBe("bafymeta");
            expect(publishTx).toHaveBeenCalledWith("my-app.dot", "bafymeta", 1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("omits the repository field when repositoryUrl is null", async () => {
        const result = await publishToPlayground({
            domain: "my-app.dot",
            publishSigner: fakeSigner,
            repositoryUrl: null,
            cwd: "/definitely/not/a/repo",
        });
        expect(result.metadata).toEqual({});
    });

    it("inlines README.md when it is present and within the cap", async () => {
        const dir = makeTmpDir();
        try {
            writeFileSync(join(dir, "README.md"), "# Hello\n\nA short readme.");
            const result = await publishToPlayground({
                domain: "readme-app",
                publishSigner: fakeSigner,
                repositoryUrl: "https://example.com/r",
                cwd: dir,
            });
            expect(result.metadata).toEqual({
                repository: "https://example.com/r",
                readme: "# Hello\n\nA short readme.",
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("omits readme when README.md exceeds the cap", async () => {
        const dir = makeTmpDir();
        try {
            writeFileSync(join(dir, "README.md"), "x".repeat(README_CAP_BYTES + 1));
            const result = await publishToPlayground({
                domain: "big-readme",
                publishSigner: fakeSigner,
                repositoryUrl: "https://example.com/r",
                cwd: dir,
            });
            expect(result.metadata).toEqual({ repository: "https://example.com/r" });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("passes visibility=0 when isPrivate is true", async () => {
        await publishToPlayground({
            domain: "secret",
            publishSigner: fakeSigner,
            repositoryUrl: "https://example.com/x",
            cwd: "/definitely/not/a/repo",
            isPrivate: true,
        });
        expect(publishTx).toHaveBeenCalledWith("secret.dot", "bafymeta", 0);
    });

    it("retries up to 3 times on registry publish failure", async () => {
        publishTx.mockImplementationOnce(async () => {
            throw new Error("nonce race");
        });
        publishTx.mockImplementationOnce(async () => {
            throw new Error("nonce race");
        });
        publishTx.mockImplementationOnce(async () => ({ ok: true, txHash: "0xbeef" }));

        const result = await publishToPlayground({
            domain: "flaky",
            publishSigner: fakeSigner,
            repositoryUrl: "https://example.com/x",
            cwd: "/definitely/not/a/repo",
        });
        expect(publishTx).toHaveBeenCalledTimes(3);
        expect(result.fullDomain).toBe("flaky.dot");
    }, 30_000);

    it("captures a warning when registry publish retries", async () => {
        publishTx
            .mockRejectedValueOnce(new Error("temporary registry failure"))
            .mockResolvedValueOnce({ ok: true, txHash: "0xdead" });

        await publishToPlayground({
            domain: "my-app.dot",
            publishSigner: fakeSigner,
            repositoryUrl: null,
            cwd: undefined,
        });

        expect(captureWarningMock).toHaveBeenCalledWith(
            "Playground registry publish failed, retrying",
            expect.objectContaining({
                attempt: 1,
                maxAttempts: 3,
                error: "temporary registry failure",
            }),
        );
    }, 30_000);

    it("wraps metadata upload and registry publish in spans", async () => {
        await publishToPlayground({
            domain: "my-app.dot",
            publishSigner: fakeSigner,
            repositoryUrl: null,
            cwd: undefined,
        });

        const ops = withSpanMock.mock.calls.map((call) => call[0]);
        expect(ops).toContain("cli.deploy.playground.metadata-upload");
        expect(ops).toContain("cli.deploy.playground.registry-publish");
    });

    it("surfaces the last error after exhausting retries", async () => {
        publishTx.mockImplementation(async () => {
            throw new Error("unauthorized");
        });

        await expect(
            publishToPlayground({
                domain: "doomed",
                publishSigner: fakeSigner,
                repositoryUrl: "https://example.com/x",
                cwd: "/definitely/not/a/repo",
            }),
        ).rejects.toThrow(/unauthorized/);
    }, 30_000);
});
