/**
 * Vitest globalSetup — runs once before all E2E tests.
 *
 * 1. Top up the deployer (SIGNER) if its substrate balance is low
 * 2. Verify test template exists in registry (if configured)
 * 3. Log test accounts
 */

import { destroyTestClient } from "../helpers/chain.js";
import { fundDeployerIfLow } from "./fund.js";
import { ensureTemplateRegistered } from "../fixtures/registry.js";
import { SIGNER, BOB } from "../fixtures/accounts.js";

export async function setup() {
	console.log("[e2e setup] Playground CLI E2E test suite starting…");
	console.log(`[e2e setup] SIGNER (${SIGNER.name}): ${SIGNER.address} (h160 ${SIGNER.h160})`);
	console.log(`[e2e setup] BOB:    ${BOB.address}`);

	// These require chain connectivity — they'll log warnings if the chain
	// is unreachable rather than failing the entire suite. This lets the
	// no-chain tests (install, build) still run in offline environments.
	try {
		await fundDeployerIfLow();
		await ensureTemplateRegistered();
	} catch (err) {
		console.warn(`[e2e setup] Chain setup failed (offline tests will still run): ${err}`);
	}
}

export async function teardown() {
	try {
		destroyTestClient();
	} catch {
		// The WebSocket may already be torn down (heartbeat timeout, DisjointError).
		// Best-effort cleanup — nothing to do if it's already gone.
	}
}
