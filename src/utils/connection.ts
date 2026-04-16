import { getChainAPI } from "@polkadot-apps/chain-client";

export type PaseoClient = Awaited<ReturnType<typeof getChainAPI<"paseo">>>;

/** If getChainAPI doesn't resolve in this window we treat the attempt as dead. */
const CONNECT_TIMEOUT_MS = 30_000;

let connectionPromise: Promise<PaseoClient> | null = null;
let client: PaseoClient | null = null;

function timeoutAfter(ms: number): Promise<never> {
    return new Promise((_, reject) =>
        setTimeout(
            () =>
                reject(new Error(`Timed out connecting to Paseo after ${Math.round(ms / 1000)}s`)),
            ms,
        ),
    );
}

export function getConnection(): Promise<PaseoClient> {
    if (!connectionPromise) {
        connectionPromise = Promise.race([
            getChainAPI("paseo").then((c) => {
                client = c;
                return c;
            }),
            timeoutAfter(CONNECT_TIMEOUT_MS),
        ]).catch((err: unknown) => {
            // Reset so the next call can retry instead of replaying the error.
            connectionPromise = null;
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(
                `Could not connect to Paseo network — check your internet connection (${detail})`,
                { cause: err instanceof Error ? err : undefined },
            );
        });
    }
    return connectionPromise;
}

export function destroyConnection(): void {
    if (client) {
        client.destroy();
        client = null;
    }
    connectionPromise = null;
}
