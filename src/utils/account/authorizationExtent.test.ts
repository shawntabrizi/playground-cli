import { describe, it, expect } from "vitest";
import { remainingAuthorizationExtent } from "./authorizationExtent.js";

describe("remainingAuthorizationExtent", () => {
    it("subtracts used quota from granted allowance", () => {
        expect(
            remainingAuthorizationExtent({
                transactions: 250,
                transactions_allowance: 1000,
                bytes: 12_500_000n,
                bytes_allowance: 100_000_000n,
            }),
        ).toEqual({
            transactions: 750,
            bytes: 87_500_000n,
        });
    });

    it("treats zero usage as full remaining allowance", () => {
        expect(
            remainingAuthorizationExtent({
                transactions: 0,
                transactions_allowance: 3000,
                bytes: 0n,
                bytes_allowance: 300_000_000n,
            }),
        ).toEqual({
            transactions: 3000,
            bytes: 300_000_000n,
        });
    });

    it("clamps over-consumed quota at zero", () => {
        expect(
            remainingAuthorizationExtent({
                transactions: 1001,
                transactions_allowance: 1000,
                bytes: 101_000_000n,
                bytes_allowance: 100_000_000n,
            }),
        ).toEqual({
            transactions: 0,
            bytes: 0n,
        });
    });

    it("rejects legacy extents without current allowance fields", () => {
        expect(() =>
            remainingAuthorizationExtent({
                transactions: 1000,
                bytes: 100_000_000n,
            }),
        ).toThrow(/transactions_allowance/);
    });
});
