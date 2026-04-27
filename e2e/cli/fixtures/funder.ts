/**
 * E2E test balance canary.
 *
 * Watches Alice's h160 balance — that's the side that pays gas for Revive
 * contract calls (deploy, registry.publish). Substrate-side balance is
 * irrelevant because no e2e test signs with a substrate-only account.
 *
 * Logs a warning and opens a GitHub issue if the balance falls below the
 * threshold. Does NOT fail the test run — funding is a manual ops task
 * (faucet at https://faucet.polkadot.io/?network=pah).
 */

import { queryH160Balance } from "../helpers/chain.js";
import { ALICE } from "./accounts.js";

const FUNDER_LOW_THRESHOLD_DOT = BigInt(process.env.FUNDER_LOW_THRESHOLD_DOT ?? "10");
const DOT = 10_000_000_000n; // 1 DOT = 10^10 planck

/**
 * Get Alice's h160 free balance in planck (the asset that gets drained
 * by every Revive call).
 */
export async function getE2eFunderBalance(): Promise<bigint> {
	return queryH160Balance(ALICE.h160);
}

/**
 * Check Alice's h160 balance and create a GitHub issue if it's low.
 * Logs a warning but does NOT fail the test run.
 */
export async function checkFunderAndWarn(): Promise<void> {
	try {
		const balance = await getE2eFunderBalance();
		const balanceDot = balance / DOT;
		console.log(
			`[e2e setup] Alice h160 balance: ${balanceDot} DOT (${ALICE.h160})`,
		);

		if (balanceDot < FUNDER_LOW_THRESHOLD_DOT) {
			console.warn(
				`[e2e setup] ⚠️ Alice h160 balance is below ${FUNDER_LOW_THRESHOLD_DOT} DOT — tests may fail`,
			);
			await createLowBalanceIssue(balance);
		}
	} catch (err) {
		console.warn(`[e2e setup] Could not check Alice balance: ${err}`);
	}
}

async function createLowBalanceIssue(balance: bigint): Promise<void> {
	const ghToken = process.env.GITHUB_TOKEN;
	const ghRepo = process.env.GITHUB_REPO;
	if (!ghToken || !ghRepo) {
		console.warn("[e2e setup] GITHUB_TOKEN or GITHUB_REPO not set — skipping issue creation");
		return;
	}

	const title = "⚠️ E2E test signer (Alice h160) is low — please top up";

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

		const body = `Alice's h160 balance is **${balance / DOT} DOT** (${balance} planck), which is below the threshold of ${FUNDER_LOW_THRESHOLD_DOT} DOT.\n\nh160: \`${ALICE.h160}\`\n\nPlease top up via the faucet: https://faucet.polkadot.io/?network=pah`;
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
