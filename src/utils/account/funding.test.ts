/**
 * Tests for balance checks and Alice-based funding.
 *
 * We mock only `@polkadot-apps/tx` — the SDK boundary we don't want to
 * exercise in unit tests. The real `polkadot-api` `Enum(...)` is used so the
 * `transfer_keep_alive({ dest: Enum("Id", …) })` call fails loudly if anyone
 * changes the variant name ("Id" → "Index", etc.) without updating tests.
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

const { checkBalance, ensureFunded, FUND_AMOUNT } = await import("./funding.js");

function makeClient(free: bigint) {
    const transferFactory = vi.fn().mockImplementation((args: unknown) => ({
        __kind: "transfer_keep_alive",
        args,
    }));
    return {
        client: {
            assetHub: {
                query: {
                    System: {
                        Account: {
                            getValue: vi.fn().mockResolvedValue({
                                data: { free, reserved: 0n, frozen: 0n },
                            }),
                        },
                    },
                },
                tx: {
                    Balances: {
                        transfer_keep_alive: transferFactory,
                    },
                },
            },
        } as any,
        transferFactory,
    };
}

describe("checkBalance", () => {
    it("reports sufficient when balance >= 1 PAS", async () => {
        const { client } = makeClient(10_000_000_000n);
        const result = await checkBalance(
            client,
            "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        );
        expect(result.sufficient).toBe(true);
        expect(result.free).toBe(10_000_000_000n);
    });

    it("reports insufficient when balance < 1 PAS", async () => {
        const { client } = makeClient(5_000_000_000n);
        const result = await checkBalance(
            client,
            "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        );
        expect(result.sufficient).toBe(false);
    });

    it("reports insufficient when balance is zero", async () => {
        const { client } = makeClient(0n);
        const result = await checkBalance(
            client,
            "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        );
        expect(result.sufficient).toBe(false);
        expect(result.free).toBe(0n);
    });
});

describe("ensureFunded", () => {
    it("skips funding when balance is sufficient", async () => {
        mockSubmitAndWatch.mockClear();
        const { client } = makeClient(50_000_000_000n);
        await ensureFunded(client, "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
        expect(mockSubmitAndWatch).not.toHaveBeenCalled();
    });

    it("funds with FUND_AMOUNT, uses Alice, and wraps the dest in Enum('Id', …)", async () => {
        mockSubmitAndWatch.mockClear();
        mockCreateDevSigner.mockClear();
        const { client, transferFactory } = makeClient(0n);
        const address = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
        await ensureFunded(client, address);

        expect(mockCreateDevSigner).toHaveBeenCalledWith("Alice");
        expect(mockSubmitAndWatch).toHaveBeenCalledTimes(1);
        expect(transferFactory).toHaveBeenCalledTimes(1);

        const callArgs = transferFactory.mock.calls[0][0] as {
            dest: { type: string; value: { type: string; value: unknown } };
            value: bigint;
        };
        // We don't mock polkadot-api — Enum() actually builds the runtime
        // tag. If the caller ever changes "Id" to "Index", this assertion
        // breaks even though the variable name looks correct.
        expect(callArgs.value).toBe(FUND_AMOUNT);
        expect(callArgs.dest).toMatchObject({ type: "Id" });
    });
});
