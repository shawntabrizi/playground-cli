import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the metadata upload path so we never actually touch the network.
// The mock returns a fake CID that publish() treats as the metadata CID.
vi.mock("@polkadot-apps/bulletin", () => ({
    upload: vi.fn(async () => ({ cid: "bafymeta", blockHash: "0x0" })),
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

import { publishToPlayground, normalizeDomain, normalizeGitRemote } from "./playground.js";
import type { ResolvedSigner } from "../signer.js";

const fakeSigner: ResolvedSigner = {
    signer: {} as any,
    address: "5Fake",
    source: "session",
    destroy: () => {},
};

beforeEach(() => {
    publishTx.mockClear();
    publishTx.mockImplementation(async () => ({ ok: true, txHash: "0xdead" }));
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

describe("normalizeGitRemote", () => {
    it("converts SSH URLs to HTTPS and strips .git", () => {
        expect(normalizeGitRemote("git@github.com:paritytech/playground-cli.git\n")).toBe(
            "https://github.com/paritytech/playground-cli",
        );
    });

    it("strips .git from HTTPS URLs", () => {
        expect(normalizeGitRemote("https://github.com/foo/bar.git")).toBe(
            "https://github.com/foo/bar",
        );
    });

    it("leaves non-.git URLs unchanged", () => {
        expect(normalizeGitRemote("https://example.com/app")).toBe("https://example.com/app");
    });
});

describe("publishToPlayground", () => {
    it("uploads metadata JSON and calls registry.publish with the phone signer", async () => {
        const result = await publishToPlayground({
            domain: "my-app",
            publishSigner: fakeSigner,
            repositoryUrl: "https://github.com/paritytech/example",
        });

        expect(result.fullDomain).toBe("my-app.dot");
        expect(result.metadata).toEqual({ repository: "https://github.com/paritytech/example" });
        expect(result.metadataCid).toBe("bafymeta");
        expect(publishTx).toHaveBeenCalledWith("my-app.dot", "bafymeta");
    });

    it("omits the repository field when no git remote is available", async () => {
        const result = await publishToPlayground({
            domain: "my-app.dot",
            publishSigner: fakeSigner,
            repositoryUrl: undefined,
            // Force the git probe to return null without touching the user's real repo.
            cwd: "/definitely/not/a/repo",
        });
        expect(result.metadata).toEqual({});
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
        });
        expect(publishTx).toHaveBeenCalledTimes(3);
        expect(result.fullDomain).toBe("flaky.dot");
    }, 30_000);

    it("surfaces the last error after exhausting retries", async () => {
        publishTx.mockImplementation(async () => {
            throw new Error("unauthorized");
        });

        await expect(
            publishToPlayground({
                domain: "doomed",
                publishSigner: fakeSigner,
                repositoryUrl: "https://example.com/x",
            }),
        ).rejects.toThrow(/unauthorized/);
    }, 30_000);
});
