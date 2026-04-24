/**
 * Vitest globalSetup — runs once before all E2E tests.
 *
 * 1. Check funder balance and warn if low
 * 2. Verify test template exists in registry (if configured)
 * 3. Log test accounts and balances
 */

import { destroyTestClient } from "../helpers/chain.js";
import { checkFunderAndWarn } from "../fixtures/funder.js";
import { ensureTemplateRegistered } from "../fixtures/registry.js";
import { ALICE, BOB } from "../fixtures/accounts.js";

export async function setup() {
	console.log("[e2e setup] Playground CLI E2E test suite starting…");
	console.log(`[e2e setup] ALICE: ${ALICE.address}`);
	console.log(`[e2e setup] BOB:   ${BOB.address}`);

	// These require chain connectivity — they'll log warnings if the chain
	// is unreachable rather than failing the entire suite. This lets the
	// no-chain tests (install, build) still run in offline environments.
	try {
		await checkFunderAndWarn();
		await ensureTemplateRegistered();
	} catch (err) {
		console.warn(`[e2e setup] Chain setup failed (offline tests will still run): ${err}`);
	}
}

export async function teardown() {
	destroyTestClient();
}
