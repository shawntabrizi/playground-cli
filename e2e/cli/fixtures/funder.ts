/**
 * Master funder account for E2E tests.
 *
 * The funder is the account whose seed is provided via MASTER_FUNDER_SEED.
 * Falls back to Alice dev account for local runs.
 */

import { queryBalance } from "../helpers/chain.js";
import { ALICE } from "./accounts.js";

const FUNDER_LOW_THRESHOLD_DOT = BigInt(process.env.FUNDER_LOW_THRESHOLD_DOT ?? "10");
const DOT = 10_000_000_000n; // 1 DOT = 10^10 planck

/**
 * Get the master funder's free balance in planck.
 */
export async function getMasterFunderBalance(): Promise<bigint> {
	// Uses Alice (dev account, pre-funded on Paseo). A dedicated funder account
	// via MASTER_FUNDER_SEED can be added when testnet token management is needed.
	return queryBalance(ALICE.address);
}

/**
 * Check the funder balance and create a GitHub issue if it's low.
 * Logs a warning but does NOT fail the test run.
 */
export async function checkFunderAndWarn(): Promise<void> {
	try {
		const balance = await getMasterFunderBalance();
		const balanceDot = balance / DOT;
		console.log(`[e2e setup] Funder balance: ${balanceDot} DOT (${balance} planck)`);

		if (balanceDot < FUNDER_LOW_THRESHOLD_DOT) {
			console.warn(
				`[e2e setup] ⚠️ Funder balance is below ${FUNDER_LOW_THRESHOLD_DOT} DOT — tests may fail`,
			);
			await createLowBalanceIssue(balance);
		}
	} catch (err) {
		console.warn(`[e2e setup] Could not check funder balance: ${err}`);
	}
}

async function createLowBalanceIssue(balance: bigint): Promise<void> {
	const ghToken = process.env.GITHUB_TOKEN;
	const ghRepo = process.env.GITHUB_REPO;
	if (!ghToken || !ghRepo) {
		console.warn("[e2e setup] GITHUB_TOKEN or GITHUB_REPO not set — skipping issue creation");
		return;
	}

	const title = "⚠️ Playground CLI test funder account is low — please top up";

	try {
		// Check for existing open issue with the same title
		const searchRes = await fetch(
			`https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${ghRepo} is:open in:title "${title}"`)}`,
			{ headers: { Authorization: `Bearer ${ghToken}` } },
		);
		if (!searchRes.ok) {
			console.warn(`[e2e setup] GitHub search API returned ${searchRes.status} — skipping issue check`);
			return;
		}
		const searchData = (await searchRes.json()) as { total_count: number };
		if (searchData.total_count > 0) {
			console.log("[e2e setup] Low-balance issue already open — skipping creation");
			return;
		}

		// Create the issue
		const body = `The E2E test funder account balance is **${balance / DOT} DOT** (${balance} planck), which is below the threshold of ${FUNDER_LOW_THRESHOLD_DOT} DOT.\n\nPlease top up the funder account (Alice on Paseo) to ensure E2E tests can run.\n\nFaucet: https://faucet.polkadot.io/?network=pah`;
		const createRes = await fetch(`https://api.github.com/repos/${ghRepo}/issues`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${ghToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ title, body }),
		});
		if (!createRes.ok) {
			console.warn(`[e2e setup] GitHub issue creation returned ${createRes.status}`);
			return;
		}
		console.log("[e2e setup] Created low-balance issue on GitHub");
	} catch (err) {
		console.warn(`[e2e setup] Failed to create GitHub issue: ${err}`);
	}
}
