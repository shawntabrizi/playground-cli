/**
 * E2E test funder account.
 *
 * Uses a dedicated account whose seed is provided via E2E_FUNDER_SEED.
 * Falls back to Alice dev account for local runs.
 */

import { queryBalance } from "../helpers/chain.js";
import { ALICE } from "./accounts.js";

const FUNDER_LOW_THRESHOLD_DOT = BigInt(process.env.FUNDER_LOW_THRESHOLD_DOT ?? "10");
const DOT = 10_000_000_000n; // 1 DOT = 10^10 planck

/** Address of the dedicated E2E funder account (generated 2026-04-24). */
const E2E_FUNDER_ADDRESS = "5GLMswFYUU1RgKaQDaqsT9XdGGh4kPbSo1NF7gLiZJZg8Hmx";

/**
 * Get the E2E funder's free balance in planck.
 * Uses the dedicated funder if E2E_FUNDER_SEED is set, otherwise falls back to Alice.
 */
export async function getE2eFunderBalance(): Promise<bigint> {
	const address = process.env.E2E_FUNDER_SEED ? E2E_FUNDER_ADDRESS : ALICE.address;
	return queryBalance(address);
}

/**
 * Check the funder balance and create a GitHub issue if it's low.
 * Logs a warning but does NOT fail the test run.
 */
export async function checkFunderAndWarn(): Promise<void> {
	try {
		const balance = await getE2eFunderBalance();
		const balanceDot = balance / DOT;
		const usingDedicated = !!process.env.E2E_FUNDER_SEED;
		console.log(
			`[e2e setup] Funder balance: ${balanceDot} DOT (${usingDedicated ? "dedicated" : "Alice fallback"})`,
		);

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

	const title = "⚠️ E2E test funder account is low — please top up";

	try {
		const searchRes = await fetch(
			`https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${ghRepo} is:open in:title "${title}"`)}`,
			{ headers: { Authorization: `Bearer ${ghToken}` } },
		);
		if (!searchRes.ok) {
			console.warn(
				`[e2e setup] GitHub search API returned ${searchRes.status} — skipping issue check`,
			);
			return;
		}
		const searchData = (await searchRes.json()) as { total_count: number };
		if (searchData.total_count > 0) {
			console.log("[e2e setup] Low-balance issue already open — skipping creation");
			return;
		}

		const address = process.env.E2E_FUNDER_SEED ? E2E_FUNDER_ADDRESS : ALICE.address;
		const body = `The E2E test funder account balance is **${balance / DOT} DOT** (${balance} planck), which is below the threshold of ${FUNDER_LOW_THRESHOLD_DOT} DOT.\n\nAddress: \`${address}\`\n\nPlease top up via the faucet: https://faucet.polkadot.io/?network=pah`;
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
