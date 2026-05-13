// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Registry contract query helpers for E2E tests.
 *
 * Queries the on-chain playground registry to verify deploy outcomes.
 */

import { ContractManager } from "@parity/product-sdk-contracts";
import { createDevSigner, getDevPublicKey } from "@parity/product-sdk-tx";
import { ss58Encode } from "@parity/product-sdk-address";
import { getTestClient } from "../helpers/chain.js";
import {
	PLAYGROUND_REGISTRY_CONTRACT,
	suppressReviveTraceNoise,
	withRequiredLiveContractAddresses,
} from "../../../src/utils/contractManifest.js";
import { resolveSigner } from "../../../src/utils/signer.js";
import { publishToPlayground } from "../../../src/utils/deploy/playground.js";
import { SIGNER } from "./accounts.js";

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
		if (!res.success) return null;
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
	if (!res.success) {
		throw new Error(`getApps query failed at dry-run: ${JSON.stringify(res.value)}`);
	}
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
 * Ensure the test template fixture is registered against the live playground
 * registry contract. The mod test is read-only (it does not publish), so unlike
 * the deploy fixtures — which the deploy tests re-publish on every run — this
 * fixture would otherwise drift out of existence whenever the registry contract
 * is redeployed. Register-if-missing keeps the suite self-healing across
 * registry redeploys without ever burning a fresh DotNS entry: same domain,
 * same owner, idempotent re-publish (no-op if already registered).
 *
 * Soft-fails into globalSetup's catch — non-mod tests should still run on a
 * degraded chain. The mod test will fail loudly downstream if the registration
 * itself failed.
 */
export async function ensureTemplateRegistered(): Promise<void> {
	const domain = process.env.TEST_TEMPLATE_DOMAIN;
	if (!domain) {
		console.warn("[e2e setup] TEST_TEMPLATE_DOMAIN not set — skipping template check");
		return;
	}

	const existing = await getApp(domain);
	if (existing) {
		console.log(`[e2e setup] Template "${domain}" already registered`);
		return;
	}

	const repositoryUrl = process.env.TEST_TEMPLATE_REPO;
	if (!repositoryUrl) {
		throw new Error(
			`Test template "${domain}" is not registered and TEST_TEMPLATE_REPO is unset — ` +
				`cannot bootstrap. Set TEST_TEMPLATE_REPO to the upstream source repository.`,
		);
	}

	console.log(
		`[e2e setup] Template "${domain}" missing — registering against the live registry contract…`,
	);
	// Same SIGNER the rest of the suite uses — it's already funded by
	// fundDeployerIfLow() earlier in globalSetup, so no extra balance check
	// here. Mirrors tools/register-e2e-fixtures.ts.
	const signer = await resolveSigner({ suri: SIGNER.suri });
	try {
		const result = await publishToPlayground({
			domain,
			publishSigner: signer,
			repositoryUrl,
		});
		console.log(`[e2e setup] Template "${domain}" registered (cid ${result.metadataCid})`);
	} finally {
		signer.destroy();
	}
}
