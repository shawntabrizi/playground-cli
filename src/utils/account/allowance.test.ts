/**
 * Tests for bulletin allowance checks and Alice-based granting.
 *
 * Only `@polkadot-apps/tx` is mocked — we use the real `polkadot-api`
 * `Enum(...)` so a mistake like `Enum("User", …)` instead of `Enum("Account", …)`
 * fails the test rather than silently passing a placeholder through.
 */

import { describe, it, expect, vi } from "vitest";

const mockSubmitAndWatch = vi
    .fn<(tx: unknown, signer: unknown) => Promise<unknown>>()
    .mockResolvedValue({ ok: true });
const mockCreateDevSigner = vi
    .fn<(name: string) => unknown>()
    .mockImplementation((name) => ({ __devSigner: name }));

vi.mock("@polkadot-apps/tx", () => ({
    submitAndWatch: (...args: unknown[]) => mockSubmitAndWatch(args[0], args[1] as unknown),
    createDevSigner: (...args: unknown[]) => mockCreateDevSigner(args[0] as string),
}));

const { checkAllowance, ensureAllowance, BULLETIN_BYTES, BULLETIN_TRANSACTIONS, LOW_TX_THRESHOLD } =
    await import("./allowance.js");

function makeClient(authResult: unknown) {
    const authorizeFactory = vi.fn().mockImplementation((args: unknown) => ({
        __kind: "authorize_account",
        args,
    }));
    return {
        client: {
            bulletin: {
                query: {
                    TransactionStorage: {
                        Authorizations: {
                            getValue: vi.fn().mockResolvedValue(authResult),
                        },
                    },
                },
                tx: {
                    TransactionStorage: {
                        authorize_account: authorizeFactory,
                    },
                },
            },
        } as any,
        authorizeFactory,
    };
}

describe("checkAllowance", () => {
    it("returns unauthorized when no authorization exists", async () => {
        const { client } = makeClient(undefined);
        const result = await checkAllowance(client, "5GrwvaEF...");
        expect(result.authorized).toBe(false);
        expect(result.remainingTxs).toBe(0);
        expect(result.remainingBytes).toBe(0n);
    });

    it("returns authorized with remaining quota", async () => {
        const { client } = makeClient({
            extent: { transactions: 500, bytes: 50_000_000n },
            expiration: 999999,
        });
        const result = await checkAllowance(client, "5GrwvaEF...");
        expect(result.authorized).toBe(true);
        expect(result.remainingTxs).toBe(500);
        expect(result.remainingBytes).toBe(50_000_000n);
    });

    it("returns authorized even with low remaining txs", async () => {
        const { client } = makeClient({
            extent: { transactions: 5, bytes: 1_000_000n },
            expiration: 100,
        });
        const result = await checkAllowance(client, "5GrwvaEF...");
        expect(result.authorized).toBe(true);
        expect(result.remainingTxs).toBe(5);
    });

    it("wraps the address in Enum('Account', …) when querying Authorizations", async () => {
        const { client } = makeClient(undefined);
        await checkAllowance(client, "5GrwvaEFaddr");

        const getValueFn = client.bulletin.query.TransactionStorage.Authorizations.getValue;
        const firstArg = getValueFn.mock.calls[0][0];
        expect(firstArg).toMatchObject({ type: "Account", value: "5GrwvaEFaddr" });
    });
});

describe("ensureAllowance", () => {
    it("skips granting when allowance is sufficient", async () => {
        mockSubmitAndWatch.mockClear();
        const { client } = makeClient({
            extent: { transactions: 500, bytes: 50_000_000n },
            expiration: 999999,
        });
        await ensureAllowance(client, "5GrwvaEF...");
        expect(mockSubmitAndWatch).not.toHaveBeenCalled();
    });

    it("grants allowance when not authorized", async () => {
        mockSubmitAndWatch.mockClear();
        mockCreateDevSigner.mockClear();
        const { client, authorizeFactory } = makeClient(undefined);
        await ensureAllowance(client, "5GrwvaEFaddr");

        expect(mockCreateDevSigner).toHaveBeenCalledWith("Alice");
        expect(mockSubmitAndWatch).toHaveBeenCalledTimes(1);
        expect(authorizeFactory).toHaveBeenCalledWith({
            who: "5GrwvaEFaddr",
            transactions: BULLETIN_TRANSACTIONS,
            bytes: BULLETIN_BYTES,
        });
    });

    it(`re-grants allowance when remaining txs are below LOW_TX_THRESHOLD (${LOW_TX_THRESHOLD})`, async () => {
        mockSubmitAndWatch.mockClear();
        const { client } = makeClient({
            extent: { transactions: LOW_TX_THRESHOLD - 5, bytes: 1_000_000n },
            expiration: 100,
        });
        await ensureAllowance(client, "5GrwvaEF...");
        expect(mockSubmitAndWatch).toHaveBeenCalledTimes(1);
    });

    it(`skips granting at exactly LOW_TX_THRESHOLD (${LOW_TX_THRESHOLD})`, async () => {
        mockSubmitAndWatch.mockClear();
        const { client } = makeClient({
            extent: { transactions: LOW_TX_THRESHOLD, bytes: 10_000_000n },
            expiration: 100,
        });
        await ensureAllowance(client, "5GrwvaEF...");
        expect(mockSubmitAndWatch).not.toHaveBeenCalled();
    });
});
