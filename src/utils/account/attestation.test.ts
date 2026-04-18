import { describe, it, expect, vi } from "vitest";
import {
    formatAttestation,
    humanizeDuration,
    checkAttestation,
    type AttestationStatus,
} from "./attestation.js";

const SIX_SECONDS = 6_000;

// ── humanizeDuration ─────────────────────────────────────────────────────────

describe("humanizeDuration", () => {
    it("floors to 1m for any positive sub-minute input", () => {
        expect(humanizeDuration(1_000)).toBe("~1m");
        expect(humanizeDuration(45_000)).toBe("~1m");
    });

    it("renders minutes below an hour", () => {
        expect(humanizeDuration(47 * 60_000)).toBe("~47m");
    });

    it("renders hours (with minutes when non-zero) below a day", () => {
        expect(humanizeDuration(3 * 3_600_000 + 15 * 60_000)).toBe("~3h 15m");
        expect(humanizeDuration(5 * 3_600_000)).toBe("~5h");
    });

    it("renders days (with hours when non-zero) up to 30d", () => {
        expect(humanizeDuration(13 * 86_400_000 + 4 * 3_600_000)).toBe("~13d 4h");
        expect(humanizeDuration(7 * 86_400_000)).toBe("~7d");
    });

    it("returns >30d for anything beyond", () => {
        expect(humanizeDuration(30 * 86_400_000)).toBe(">30d");
        expect(humanizeDuration(400 * 86_400_000)).toBe(">30d");
    });

    it("returns 0m for zero or negative values", () => {
        expect(humanizeDuration(0)).toBe("0m");
        expect(humanizeDuration(-1)).toBe("0m");
    });
});

// ── formatAttestation ────────────────────────────────────────────────────────

const unauthorized: AttestationStatus = {
    authorized: false,
    expired: false,
    remainingBlocks: 0,
    expiresAt: undefined,
    remainingTxs: undefined,
    remainingBytes: undefined,
};

describe("formatAttestation", () => {
    it("reports 'not attested' when authorization is missing", () => {
        expect(formatAttestation(unauthorized, SIX_SECONDS)).toEqual({
            text: "not attested",
            tone: "muted",
        });
    });

    it("reports expired with block number when authorization exists but has lapsed", () => {
        const expired: AttestationStatus = {
            authorized: true,
            expired: true,
            remainingBlocks: 0,
            expiresAt: 14_582_331,
            remainingTxs: 1000,
            remainingBytes: 100_000_000n,
        };
        expect(formatAttestation(expired, SIX_SECONDS)).toEqual({
            text: "expired  ·  #14,582,331",
            tone: "danger",
        });
    });

    it("reports remaining duration + expiry block in default tone above 24h", () => {
        const remainingMs = 13 * 86_400_000 + 4 * 3_600_000;
        const active: AttestationStatus = {
            authorized: true,
            expired: false,
            remainingBlocks: Math.round(remainingMs / SIX_SECONDS),
            expiresAt: 14_582_331,
            remainingTxs: 500,
            remainingBytes: 50_000_000n,
        };
        const f = formatAttestation(active, SIX_SECONDS);
        expect(f.text).toBe("~13d 4h  ·  #14,582,331");
        expect(f.tone).toBe("default");
    });

    it("switches to warning tone when less than 24h remains", () => {
        const remainingMs = 5 * 3_600_000;
        const active: AttestationStatus = {
            authorized: true,
            expired: false,
            remainingBlocks: Math.round(remainingMs / SIX_SECONDS),
            expiresAt: 99_000,
            remainingTxs: 100,
            remainingBytes: 10_000_000n,
        };
        const f = formatAttestation(active, SIX_SECONDS);
        expect(f.text.startsWith("~5h")).toBe(true);
        expect(f.tone).toBe("warning");
    });
});

// ── checkAttestation ─────────────────────────────────────────────────────────

function makeClient(authRaw: unknown, currentBlock: number) {
    return {
        bulletin: {
            query: {
                TransactionStorage: {
                    Authorizations: { getValue: vi.fn().mockResolvedValue(authRaw) },
                },
                System: {
                    Number: { getValue: vi.fn().mockResolvedValue(currentBlock) },
                },
            },
        },
    } as any;
}

describe("checkAttestation", () => {
    it("returns unauthorized when no storage entry exists", async () => {
        const client = makeClient(undefined, 100);
        const s = await checkAttestation(client, "5GrwvaEF");
        expect(s).toEqual({
            authorized: false,
            expired: false,
            remainingBlocks: 0,
            expiresAt: undefined,
            remainingTxs: undefined,
            remainingBytes: undefined,
        });
    });

    it("derives remainingBlocks from expiration - currentBlock", async () => {
        const client = makeClient(
            { extent: { transactions: 500, bytes: 50_000_000n }, expiration: 1000 },
            200,
        );
        const s = await checkAttestation(client, "5GrwvaEF");
        expect(s.authorized).toBe(true);
        expect(s.expired).toBe(false);
        expect(s.remainingBlocks).toBe(800);
        expect(s.expiresAt).toBe(1000);
        expect(s.remainingTxs).toBe(500);
        expect(s.remainingBytes).toBe(50_000_000n);
    });

    it("marks as expired when expiration has passed", async () => {
        const client = makeClient(
            { extent: { transactions: 10, bytes: 1_000_000n }, expiration: 200 },
            500,
        );
        const s = await checkAttestation(client, "5GrwvaEF");
        expect(s.authorized).toBe(true);
        expect(s.expired).toBe(true);
        expect(s.remainingBlocks).toBe(0);
    });

    it("wraps the address in Enum('Account', ...) when querying", async () => {
        const client = makeClient(undefined, 0);
        await checkAttestation(client, "5GrwvaEF_addr");
        const arg =
            client.bulletin.query.TransactionStorage.Authorizations.getValue.mock.calls[0][0];
        expect(arg).toMatchObject({ type: "Account", value: "5GrwvaEF_addr" });
    });
});
