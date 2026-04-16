import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetChainAPI = vi.fn();
const mockDestroy = vi.fn();

vi.mock("@polkadot-apps/chain-client", () => ({
    getChainAPI: (...args: any[]) => mockGetChainAPI(...args),
}));

// Re-import after each test to reset the singleton
let getConnection: typeof import("./connection.js").getConnection;
let destroyConnection: typeof import("./connection.js").destroyConnection;

beforeEach(async () => {
    vi.resetModules();
    mockGetChainAPI.mockReset();
    mockDestroy.mockReset();
    const mod = await import("./connection.js");
    getConnection = mod.getConnection;
    destroyConnection = mod.destroyConnection;
});

describe("getConnection", () => {
    it("calls getChainAPI with 'paseo'", async () => {
        mockGetChainAPI.mockResolvedValue({ destroy: mockDestroy });
        await getConnection();
        expect(mockGetChainAPI).toHaveBeenCalledWith("paseo");
    });

    it("returns the same client on subsequent calls (singleton)", async () => {
        const fakeClient = { destroy: mockDestroy };
        mockGetChainAPI.mockResolvedValue(fakeClient);

        const first = await getConnection();
        const second = await getConnection();

        expect(first).toBe(second);
        expect(mockGetChainAPI).toHaveBeenCalledTimes(1);
    });

    it("does not race when called concurrently", async () => {
        const fakeClient = { destroy: mockDestroy };
        mockGetChainAPI.mockResolvedValue(fakeClient);

        const [a, b] = await Promise.all([getConnection(), getConnection()]);

        expect(a).toBe(b);
        expect(mockGetChainAPI).toHaveBeenCalledTimes(1);
    });

    it("throws a readable error on connection failure", async () => {
        mockGetChainAPI.mockRejectedValue(new Error("WebSocket failed"));

        await expect(getConnection()).rejects.toThrow("Could not connect to Paseo network");
    });

    it("preserves the underlying error detail in the message", async () => {
        // Regression guard — historically the outer message only said "check
        // your internet connection", which is misleading when the cause is a
        // descriptor mismatch or a bad endpoint URL.
        mockGetChainAPI.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:9944"));

        await expect(getConnection()).rejects.toThrow(/ECONNREFUSED 127\.0\.0\.1:9944/);
    });

    it("preserves the underlying error as Error.cause", async () => {
        const underlying = new Error("descriptor mismatch");
        mockGetChainAPI.mockRejectedValue(underlying);

        try {
            await getConnection();
            expect.fail("expected throw");
        } catch (err) {
            expect((err as Error).cause).toBe(underlying);
        }
    });

    it("allows retry after connection failure", async () => {
        mockGetChainAPI.mockRejectedValueOnce(new Error("timeout"));
        const fakeClient = { destroy: mockDestroy };
        mockGetChainAPI.mockResolvedValueOnce(fakeClient);

        await expect(getConnection()).rejects.toThrow();
        const client = await getConnection();
        expect(client).toBe(fakeClient);
        expect(mockGetChainAPI).toHaveBeenCalledTimes(2);
    });
});

describe("destroyConnection", () => {
    it("calls destroy on the client", async () => {
        const fakeClient = { destroy: mockDestroy };
        mockGetChainAPI.mockResolvedValue(fakeClient);

        await getConnection();
        destroyConnection();

        expect(mockDestroy).toHaveBeenCalledTimes(1);
    });

    it("allows reconnection after destroy", async () => {
        const client1 = { destroy: vi.fn() };
        const client2 = { destroy: vi.fn() };
        mockGetChainAPI.mockResolvedValueOnce(client1).mockResolvedValueOnce(client2);

        const first = await getConnection();
        destroyConnection();
        const second = await getConnection();

        expect(first).toBe(client1);
        expect(second).toBe(client2);
        expect(mockGetChainAPI).toHaveBeenCalledTimes(2);
    });

    it("is safe to call when not connected", () => {
        expect(() => destroyConnection()).not.toThrow();
    });
});
