/**
 * Test account helpers for E2E tests.
 *
 * Uses dev accounts (Alice, Bob) which bypass the QR session system
 * entirely via --suri. These are pre-funded on Paseo testnet.
 */

import { ss58Encode } from "@polkadot-apps/address";
import { getDevPublicKey, type DevAccountName } from "@polkadot-apps/tx";

export interface TestAccount {
	name: DevAccountName;
	suri: string;
	address: string;
}

export const ALICE: TestAccount = {
	name: "Alice",
	suri: "//Alice",
	address: ss58Encode(getDevPublicKey("Alice")),
};

export const BOB: TestAccount = {
	name: "Bob",
	suri: "//Bob",
	address: ss58Encode(getDevPublicKey("Bob")),
};

/**
 * Generate a unique .dot domain name for deploy tests.
 * Uses timestamp + random suffix to avoid DotNS collisions across runs.
 */
export function uniqueDomain(): string {
	const ts = Date.now();
	const rand = Math.random().toString(36).slice(2, 6);
	return `e2e-${ts}-${rand}`;
}
