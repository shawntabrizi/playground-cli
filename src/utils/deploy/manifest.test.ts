import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest, writeManifest, type DeployManifest } from "./manifest.js";
import type { DeployOutcome } from "./run.js";

const baseOutcome: DeployOutcome = {
    fullDomain: "my-app.dot",
    appCid: "bafybeiexampleappcid",
    ipfsCid: "bafybeiexampleipfscid",
    metadataCid: "bafybeiexamplemetadatacid",
    appUrl: "https://my-app.dot.li",
    approvalsRequested: [],
    contracts: [
        {
            name: "ProofOfExistence",
            address: "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`,
        },
        {
            name: "Counter",
            address: "0xabcdef1234567890abcdef1234567890abcdef12" as `0x${string}`,
        },
    ],
};

describe("buildManifest", () => {
    it("carries all outcome fields into a versioned manifest", () => {
        const manifest = buildManifest(baseOutcome);

        expect(manifest.version).toBe(1);
        expect(manifest.fullDomain).toBe("my-app.dot");
        expect(manifest.appUrl).toBe("https://my-app.dot.li");
        expect(manifest.appCid).toBe("bafybeiexampleappcid");
        expect(manifest.ipfsCid).toBe("bafybeiexampleipfscid");
        expect(manifest.metadataCid).toBe("bafybeiexamplemetadatacid");
        expect(manifest.contracts).toEqual([
            {
                name: "ProofOfExistence",
                address: "0x1234567890abcdef1234567890abcdef12345678",
            },
            { name: "Counter", address: "0xabcdef1234567890abcdef1234567890abcdef12" },
        ]);
    });

    it("omits ipfsCid and metadataCid when they are undefined (stable JSON)", () => {
        const manifest = buildManifest({
            ...baseOutcome,
            ipfsCid: undefined,
            metadataCid: undefined,
        });

        expect("ipfsCid" in manifest).toBe(false);
        expect("metadataCid" in manifest).toBe(false);
    });

    it("produces an empty contracts array when no contracts were deployed", () => {
        const manifest = buildManifest({ ...baseOutcome, contracts: [] });
        expect(manifest.contracts).toEqual([]);
    });

    it("preserves contract order from the outcome", () => {
        const manifest = buildManifest(baseOutcome);
        expect(manifest.contracts.map((c) => c.name)).toEqual(["ProofOfExistence", "Counter"]);
    });
});

describe("writeManifest", () => {
    let tmp: string;

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), "pg-manifest-"));
    });

    afterEach(() => {
        rmSync(tmp, { recursive: true, force: true });
    });

    it("writes valid JSON with a trailing newline that round-trips", () => {
        const path = join(tmp, "deploy.json");
        const manifest = buildManifest(baseOutcome);
        writeManifest(path, manifest);

        const raw = readFileSync(path, "utf8");
        expect(raw.endsWith("\n")).toBe(true);
        const parsed: DeployManifest = JSON.parse(raw);
        expect(parsed).toEqual(manifest);
    });

    it("creates parent directories if they don't exist", () => {
        const path = join(tmp, "nested", "deep", "deploy.json");
        const manifest = buildManifest(baseOutcome);
        writeManifest(path, manifest);

        expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(manifest);
    });
});
