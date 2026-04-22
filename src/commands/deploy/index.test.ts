import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mockReadSessionAccount = vi.fn();
const mockCheckBalance = vi.fn();
const mockGetConnection = vi.fn();

vi.mock("../../utils/deploy/session-account.js", () => ({
    readSessionAccount: (...args: unknown[]) => mockReadSessionAccount(...args),
    SESSION_MIN_BALANCE: 5_000_000_000n,
    getOrCreateSessionAccount: vi.fn(),
}));

vi.mock("../../utils/account/funding.js", () => ({
    checkBalance: (...args: unknown[]) => mockCheckBalance(...args),
}));

vi.mock("../../utils/connection.js", () => ({
    getConnection: (...args: unknown[]) => mockGetConnection(...args),
    destroyConnection: vi.fn(),
}));

const { safeDetectContractsType, computeContractsFundingNeeded } = await import("./index.js");

describe("safeDetectContractsType", () => {
    let tmp: string;

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), "pg-deploy-detect-"));
    });

    afterEach(() => {
        rmSync(tmp, { recursive: true, force: true });
    });

    it("returns null for an empty project directory", () => {
        expect(safeDetectContractsType(tmp)).toBeNull();
    });

    it("returns null when the project directory does not exist", () => {
        // `loadDetectInput` throws on a missing dir — the `safe-` prefix
        // exists precisely so we can swallow that and move on.
        const missing = join(tmp, "does-not-exist");
        expect(safeDetectContractsType(missing)).toBeNull();
    });

    it("detects foundry via foundry.toml", () => {
        writeFileSync(join(tmp, "foundry.toml"), "[profile.default]\n");
        expect(safeDetectContractsType(tmp)).toBe("foundry");
    });

    it("detects hardhat via hardhat.config.ts", () => {
        writeFileSync(join(tmp, "hardhat.config.ts"), "export default {};\n");
        expect(safeDetectContractsType(tmp)).toBe("hardhat");
    });

    it("detects cdm via pvm_contract in Cargo.toml", () => {
        writeFileSync(
            join(tmp, "Cargo.toml"),
            `[package]\nname = "demo"\nversion = "0.1.0"\n\n[dependencies]\npvm_contract = "0.1"\n`,
        );
        expect(safeDetectContractsType(tmp)).toBe("cdm");
    });

    it("returns null for a Cargo.toml without a pvm_contract dep", () => {
        writeFileSync(
            join(tmp, "Cargo.toml"),
            `[package]\nname = "demo"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0"\n`,
        );
        expect(safeDetectContractsType(tmp)).toBeNull();
    });
});

// Minimal shapes — we only exercise the branches that `computeContractsFundingNeeded`
// inspects (`source`). Everything else is load-bearing only inside the real deploy.
const devSigner: any = { source: "dev", address: "5Dev", signer: {}, destroy: () => {} };
const sessionSigner: any = {
    source: "session",
    address: "5Ses",
    signer: {},
    destroy: () => {},
};

describe("computeContractsFundingNeeded", () => {
    beforeEach(() => {
        mockReadSessionAccount.mockReset();
        mockCheckBalance.mockReset();
        mockGetConnection.mockReset();
        // Default: any code path that reaches the chain gets a dummy client.
        mockGetConnection.mockResolvedValue({ __dummy: true });
    });

    it("returns false when deployContracts is false without touching chain or disk", async () => {
        const result = await computeContractsFundingNeeded({
            deployContracts: false,
            userSigner: sessionSigner,
        });
        expect(result).toBe(false);
        expect(mockReadSessionAccount).not.toHaveBeenCalled();
        expect(mockCheckBalance).not.toHaveBeenCalled();
        expect(mockGetConnection).not.toHaveBeenCalled();
    });

    it("returns false when userSigner is null without touching chain or disk", async () => {
        const result = await computeContractsFundingNeeded({
            deployContracts: true,
            userSigner: null,
        });
        expect(result).toBe(false);
        expect(mockReadSessionAccount).not.toHaveBeenCalled();
        expect(mockCheckBalance).not.toHaveBeenCalled();
        expect(mockGetConnection).not.toHaveBeenCalled();
    });

    it("returns false for a dev signer without touching chain or disk", async () => {
        const result = await computeContractsFundingNeeded({
            deployContracts: true,
            userSigner: devSigner,
        });
        expect(result).toBe(false);
        expect(mockReadSessionAccount).not.toHaveBeenCalled();
        expect(mockCheckBalance).not.toHaveBeenCalled();
        expect(mockGetConnection).not.toHaveBeenCalled();
    });

    it("returns true for a session signer when no key is persisted yet", async () => {
        mockReadSessionAccount.mockResolvedValue(null);
        const result = await computeContractsFundingNeeded({
            deployContracts: true,
            userSigner: sessionSigner,
        });
        expect(result).toBe(true);
        expect(mockReadSessionAccount).toHaveBeenCalledTimes(1);
        expect(mockCheckBalance).not.toHaveBeenCalled();
        expect(mockGetConnection).not.toHaveBeenCalled();
    });

    it("returns false when the session key has sufficient balance", async () => {
        mockReadSessionAccount.mockResolvedValue({
            account: { ss58Address: "5Ses" },
        });
        mockCheckBalance.mockResolvedValue({ sufficient: true });

        const result = await computeContractsFundingNeeded({
            deployContracts: true,
            userSigner: sessionSigner,
        });
        expect(result).toBe(false);
        expect(mockCheckBalance).toHaveBeenCalledWith({ __dummy: true }, "5Ses", 5_000_000_000n);
    });

    it("returns true when the session key balance is insufficient", async () => {
        mockReadSessionAccount.mockResolvedValue({
            account: { ss58Address: "5Ses" },
        });
        mockCheckBalance.mockResolvedValue({ sufficient: false });

        const result = await computeContractsFundingNeeded({
            deployContracts: true,
            userSigner: sessionSigner,
        });
        expect(result).toBe(true);
    });

    it("returns true (pessimistic fallback) when the balance query throws", async () => {
        mockReadSessionAccount.mockResolvedValue({
            account: { ss58Address: "5Ses" },
        });
        mockCheckBalance.mockRejectedValue(new Error("RPC went away"));

        const result = await computeContractsFundingNeeded({
            deployContracts: true,
            userSigner: sessionSigner,
        });
        expect(result).toBe(true);
    });
});
