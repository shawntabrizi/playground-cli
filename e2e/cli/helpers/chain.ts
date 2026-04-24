/**
 * Chain query helpers for E2E tests.
 *
 * Connects to Paseo Asset Hub to verify on-chain state
 * (balances, registry entries) after CLI operations.
 */

import { getChainAPI } from "@polkadot-apps/chain-client";

type PaseoClient = Awaited<ReturnType<typeof getChainAPI<"paseo">>>;

const CONNECT_TIMEOUT_MS = 30_000;

let clientPromise: Promise<PaseoClient> | null = null;
let client: PaseoClient | null = null;

/**
 * Get a cached Paseo client. Creates one on first call.
 * Reuses the same connection for all subsequent calls.
 */
export async function getTestClient(): Promise<PaseoClient> {
	if (!clientPromise) {
		clientPromise = Promise.race([
			getChainAPI("paseo").then((c) => {
				client = c;
				return c;
			}),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error(`Timed out connecting to Paseo after ${CONNECT_TIMEOUT_MS / 1000}s`)),
					CONNECT_TIMEOUT_MS,
				),
			),
		]).catch((err) => {
			clientPromise = null;
			throw err;
		});
	}
	return clientPromise;
}

/**
 * Destroy the cached chain client and release the WebSocket.
 * Call this in globalSetup teardown.
 */
export function destroyTestClient(): void {
	if (client) {
		client.destroy();
		client = null;
	}
	clientPromise = null;
}

/**
 * Query the free balance of an address on Asset Hub.
 */
export async function queryBalance(address: string): Promise<bigint> {
	const c = await getTestClient();
	const account = await c.assetHub.query.System.Account.getValue(address, { at: "best" });
	return account.data.free;
}
