import { describe, it, expect } from "vitest";
import { Buffer } from "node:buffer";
import { extractFoundryBytecode, extractHardhatBytecode, hexToBytes } from "./contracts.js";

describe("hexToBytes", () => {
    it("decodes a 0x-prefixed hex string", () => {
        expect(hexToBytes("0x50564d00")).toEqual(new Uint8Array([0x50, 0x56, 0x4d, 0x00]));
    });

    it("decodes a bare hex string without the 0x prefix", () => {
        expect(hexToBytes("deadbeef")).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it("treats an empty '0x' as a zero-length byte array", () => {
        // Abstract Solidity contracts compile to bytecode "0x"; the caller
        // uses length === 0 as the skip signal, so decoding must succeed.
        const out = hexToBytes("0x");
        expect(out).toBeInstanceOf(Uint8Array);
        expect(out.length).toBe(0);
    });

    it("treats a completely empty string as a zero-length byte array", () => {
        const out = hexToBytes("");
        expect(out).toBeInstanceOf(Uint8Array);
        expect(out.length).toBe(0);
    });

    it("throws a clear error on odd-length input", () => {
        expect(() => hexToBytes("0xabc")).toThrow(/invalid hex string \(odd length\)/);
        expect(() => hexToBytes("abc")).toThrow(/invalid hex string \(odd length\)/);
    });

    it("round-trips random byte sequences via Buffer.toString('hex')", () => {
        // Spot-check against Node's Buffer implementation to guard against
        // off-by-one bugs in the slice/parseInt loop.
        const samples: Uint8Array[] = [
            new Uint8Array([0]),
            new Uint8Array([0xff]),
            new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xfe, 0xff]),
            new Uint8Array(Array.from({ length: 64 }, (_, i) => (i * 31) & 0xff)),
            new Uint8Array(Array.from({ length: 257 }, (_, i) => i & 0xff)),
        ];
        for (const bytes of samples) {
            const hex = `0x${Buffer.from(bytes).toString("hex")}`;
            expect(hexToBytes(hex)).toEqual(bytes);
            // No-prefix variant should match too.
            expect(hexToBytes(hex.slice(2))).toEqual(bytes);
        }
    });
});

describe("extractFoundryBytecode", () => {
    it("returns the hex under bytecode.object for a well-formed artifact", () => {
        expect(extractFoundryBytecode({ bytecode: { object: "0x60806040" } })).toBe("0x60806040");
    });

    it("returns null for an empty '0x' placeholder", () => {
        // forge emits "0x" for interfaces / abstract contracts; we must skip,
        // not attempt to deploy a zero-byte blob.
        expect(extractFoundryBytecode({ bytecode: { object: "0x" } })).toBeNull();
    });

    it("returns null when bytecode.object is missing", () => {
        expect(extractFoundryBytecode({ bytecode: {} })).toBeNull();
    });

    it("returns null when the top-level bytecode field is missing", () => {
        expect(extractFoundryBytecode({})).toBeNull();
    });

    it("returns null for non-object inputs", () => {
        // JSON.parse can legitimately produce these for junk files we'd
        // rather skip than crash on.
        expect(extractFoundryBytecode(null)).toBeNull();
        expect(extractFoundryBytecode(undefined)).toBeNull();
        expect(extractFoundryBytecode("0x60806040")).toBeNull();
        expect(extractFoundryBytecode(42)).toBeNull();
    });

    it("returns null when bytecode.object is not a string", () => {
        expect(extractFoundryBytecode({ bytecode: { object: 42 } })).toBeNull();
        expect(extractFoundryBytecode({ bytecode: { object: null } })).toBeNull();
    });
});

describe("extractHardhatBytecode", () => {
    it("returns the plain-string bytecode field", () => {
        expect(extractHardhatBytecode({ bytecode: "0x60806040" })).toBe("0x60806040");
    });

    it("returns null for an empty '0x' placeholder", () => {
        expect(extractHardhatBytecode({ bytecode: "0x" })).toBeNull();
    });

    it("returns null when the bytecode field is missing", () => {
        expect(extractHardhatBytecode({})).toBeNull();
    });

    it("refuses the Foundry { object } shape", () => {
        // Hardhat artifacts store bytecode as a plain string. A misrouted
        // artifact with the Foundry nested shape should fail loudly (null →
        // skip) rather than silently feed the wrong bytes into a deploy.
        expect(extractHardhatBytecode({ bytecode: { object: "0x60806040" } })).toBeNull();
    });

    it("returns null for non-object inputs", () => {
        expect(extractHardhatBytecode(null)).toBeNull();
        expect(extractHardhatBytecode(undefined)).toBeNull();
        expect(extractHardhatBytecode("0x60806040")).toBeNull();
        expect(extractHardhatBytecode(42)).toBeNull();
    });
});
