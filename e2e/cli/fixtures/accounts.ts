/**
 * Test account helpers for E2E tests.
 *
 * Tests sign as Alice via `--suri //Alice`. The `dot` CLI's `--suri` flag
 * accepts only dev account names (Alice, Bob, Charlie, Dave, Eve, Ferdie),
 * so a dedicated funder account isn't reachable through the public CLI
 * surface — using //Alice is what real users do.
 */

import { ss58Encode, deriveH160, type HexString } from "@polkadot-apps/address";
import { getDevPublicKey, type DevAccountName } from "@polkadot-apps/tx";

export interface TestAccount {
	name: DevAccountName;
	suri: string;
	address: string;
	h160: HexString;
}

function devAccount(name: DevAccountName): TestAccount {
	const publicKey = getDevPublicKey(name);
	return {
		name,
		suri: `//${name}`,
		address: ss58Encode(publicKey),
		h160: deriveH160(publicKey),
	};
}

export const ALICE: TestAccount = devAccount("Alice");
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
