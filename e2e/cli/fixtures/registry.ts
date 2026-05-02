/**
 * Registry contract query helpers for E2E tests.
 *
 * Queries the on-chain playground registry to verify deploy outcomes.
 */

import { ContractManager } from "@polkadot-apps/contracts";
import { createDevSigner, getDevPublicKey } from "@polkadot-apps/tx";
import { ss58Encode } from "@polkadot-apps/address";
import { getTestClient } from "../helpers/chain.js";
import {
	PLAYGROUND_REGISTRY_CONTRACT,
	suppressReviveTraceNoise,
	withRequiredLiveContractAddresses,
} from "../../../src/utils/contractManifest.js";

import cdmJson from "../../../cdm.json";

export interface AppEntry {
	domain: string;
	owner: string;
	metadataUri: string;
}

type Registry = Awaited<ReturnType<Awaited<ReturnType<typeof ContractManager.fromClient>>["getContract"]>>;

let registryPromise: Promise<Registry> | null = null;

async function getRegistry(): Promise<Registry> {
	if (!registryPromise) {
		registryPromise = (async () => {
			const client = await getTestClient();
			const aliceSigner = createDevSigner("Alice");
			const aliceAddress = ss58Encode(getDevPublicKey("Alice"));
			// Mirror src/utils/registry.ts — query the CDM meta-registry for the
			// live address before binding, so the helper reads from the same
			// contract `dot mod` and `dot deploy` actually use. Without this,
			// reads land on the cdm.json snapshot and silently diverge from the
			// command paths after a registry redeploy. See issue #74.
			const manifest = await withRequiredLiveContractAddresses(cdmJson, client.raw.assetHub, [
				PLAYGROUND_REGISTRY_CONTRACT,
			]);
			const manager = await ContractManager.fromClient(manifest, client.raw.assetHub, {
				defaultSigner: aliceSigner,
				defaultOrigin: aliceAddress,
			});
			return suppressReviveTraceNoise(manager.getContract(PLAYGROUND_REGISTRY_CONTRACT));
		})().catch((err) => {
			// Reset so the next call can retry instead of replaying the error
			registryPromise = null;
			throw err;
		});
	}
	return registryPromise;
}

/**
 * Query the registry for an app entry by domain.
 * Returns null if not found.
 *
 * `getMetadataUri` returns an `Option<String>` shaped as `{ isSome, value }` —
 * always a truthy object regardless of registration. The `isSome` flag is the
 * real discriminator; check it explicitly. (See cdm.json's getMetadataUri ABI.)
 */
export async function getApp(domain: string): Promise<AppEntry | null> {
	try {
		const registry = await getRegistry();
		const res = await registry.getMetadataUri.query(domain);
		const tuple = res.value as { isSome?: boolean; value?: string } | undefined;
		if (!tuple?.isSome) return null;
		return {
			domain,
			owner: "",
			metadataUri: String(tuple.value ?? ""),
		};
	} catch {
		return null;
	}
}

/**
 * Get the total number of apps in the registry.
 */
export async function getAppCount(): Promise<number> {
	const registry = await getRegistry();
	const res = await registry.getApps.query(0, 1);
	const value = res.value as Record<string, unknown> | undefined;
	if (!value || typeof value.total !== "number") {
		throw new Error(`Unexpected getApps response shape: ${JSON.stringify(res.value)}`);
	}
	return value.total;
}

/**
 * Poll getApp until an entry appears or timeout.
 */
export async function waitForApp(domain: string, timeoutMs = 30_000): Promise<AppEntry> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const entry = await getApp(domain);
		if (entry) return entry;
		await new Promise((r) => setTimeout(r, 2_000));
	}
	throw new Error(`waitForApp: "${domain}" not found in registry after ${timeoutMs}ms`);
}

/**
 * Verify that a domain is registered in the registry.
 * Throws if not found.
 */
export async function ensureTemplateRegistered(): Promise<void> {
	const domain = process.env.TEST_TEMPLATE_DOMAIN;
	if (!domain) {
		console.warn("[e2e setup] TEST_TEMPLATE_DOMAIN not set — skipping template check");
		return;
	}

	const entry = await getApp(domain);
	if (!entry) {
		throw new Error(
			`Test template app "${domain}" not registered in the playground registry — run setup script first.`,
		);
	}
	console.log(`[e2e setup] Template "${domain}" verified in registry`);
}
