/**
 * Test account helpers for E2E tests.
 *
 * SIGNER is the dedicated E2E funder account when E2E_FUNDER_SEED is set,
 * otherwise falls back to //Alice for local runs. Tests pass SIGNER.suri to
 * `--suri`, which accepts either a mnemonic or a dev derivation path.
 *
 * BOB stays as a dev account — used by tests that need a second signer
 * (e.g. ownership/permission checks).
 */

import { ss58Encode, deriveH160, type HexString } from "@polkadot-apps/address";
import { seedToAccount } from "@polkadot-apps/keys";
import { getDevPublicKey, type DevAccountName } from "@polkadot-apps/tx";

export interface TestAccount {
	name: string;
	suri: string;
	address: string;
	h160: HexString;
}

function devAccount(name: DevAccountName, label: string = name): TestAccount {
	const publicKey = getDevPublicKey(name);
	return {
		name: label,
		suri: `//${name}`,
		address: ss58Encode(publicKey),
		h160: deriveH160(publicKey),
	};
}

/**
 * The signing account for all e2e tests.
 * - Set E2E_FUNDER_SEED (12-word mnemonic) → uses dedicated funder account
 * - Unset → falls back to //Alice (local-dev convenience)
 */
export const SIGNER: TestAccount = (() => {
	const seed = process.env.E2E_FUNDER_SEED;
	if (seed) {
		const acct = seedToAccount(seed, "");
		return {
			name: "E2E Funder",
			suri: seed,
			address: acct.ss58Address,
			h160: acct.h160Address,
		};
	}
	return devAccount("Alice", "Alice (fallback)");
})();

export const BOB: TestAccount = devAccount("Bob");

/**
 * Generate a unique .dot domain name for deploy tests.
 * Uses timestamp + random suffix to avoid DotNS collisions across runs.
 */
export function uniqueDomain(): string {
	const ts = Date.now();
	const rand = Math.random().toString(36).slice(2, 6);
	return `e2e-${ts}-${rand}`;
}
