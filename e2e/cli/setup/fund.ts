/**
 * Top up the E2E deployer account before tests run.
 *
 * Tests sign `registry.publish()` (and any other user-signed extrinsic) with
 * `SIGNER`, paying substrate-side fees from its ss58 balance. We fund it from
 * the production CLI's funder chain (`FUNDER_CHAIN`) so the deployer always
 * has enough PAS to cover an entire test run, regardless of who else has
 * been spending //Alice or any other shared dev account.
 *
 * Idempotent: only triggers a transfer when the deployer's free balance
 * dips below `MIN_BALANCE`. No-op the rest of the time.
 */

import { checkBalance, ensureFunded } from "../../../src/utils/account/funding.js";
import { getTestClient } from "../helpers/chain.js";
import { SIGNER } from "../fixtures/accounts.js";

const DOT = 10_000_000_000n;

/** Top up the deployer if it falls below this. */
export const MIN_BALANCE = 500n * DOT;

/** Amount to send when topping up. */
export const TOP_UP_AMOUNT = 1000n * DOT;

export async function fundDeployerIfLow(): Promise<void> {
	const client = await getTestClient();
	const before = await checkBalance(client, SIGNER.address, MIN_BALANCE);
	console.log(
		`[e2e setup] SIGNER (${SIGNER.name}) balance: ${before.free / DOT} DOT (${SIGNER.address})`,
	);
	if (before.sufficient) return;

	console.log(
		`[e2e setup] balance below ${MIN_BALANCE / DOT} DOT — topping up by ${TOP_UP_AMOUNT / DOT} DOT…`,
	);
	await ensureFunded(client, SIGNER.address, MIN_BALANCE, TOP_UP_AMOUNT);
	const after = await checkBalance(client, SIGNER.address, MIN_BALANCE);
	console.log(`[e2e setup] SIGNER topped up: ${after.free / DOT} DOT`);
}
