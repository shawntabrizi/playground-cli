/**
 * Test account helpers for E2E tests.
 *
 * `SIGNER` is the account that pays substrate-side fees for the user-signed
 * extrinsic in every deploy: `registry.publish()`. It's a dedicated test-only
 * keypair derived from a hardcoded mnemonic — globalSetup tops it up to a
 * known balance from the production CLI's funder chain at the start of every
 * run, so the tests don't share fee state with //Alice (which gets drained by
 * anyone using the polkadot.js Apps dropdown) or with the production CLI's
 * own dedicated funder.
 *
 * BOB stays a dev account — the cross-ownership test only needs a *different*
 * signer than SIGNER, and Bob's deploy fails at the read-only availability
 * check (no fees needed) so its substrate balance doesn't matter.
 */

import { ss58Encode, deriveH160, type HexString } from "@polkadot-apps/address";
import { getDevPublicKey, type DevAccountName } from "@polkadot-apps/tx";
import { seedToAccount } from "@polkadot-apps/keys";

export interface TestAccount {
	name: string;
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

/**
 * Hardcoded BIP-39 mnemonic for the E2E deployer account. Test-only:
 * globalSetup re-funds it from the CLI's funder chain at the start of every
 * run, so it doesn't matter that the seed is in plaintext — anyone who tries
 * to "drain" it just hands their PAS back to the next CI run when the
 * funder tops it up again.
 *
 * Phrase chosen as the canonical Substrate dev mnemonic; the `//e2e-deployer`
 * derivation produces an account distinct from //Alice/Bob/etc.
 */
export const DEDICATED_E2E_DEPLOYER_MNEMONIC =
	"bottom drive obey lake curtain smoke basket hold race lonely fit walk";

const E2E_DEPLOYER_DERIVATION = "//e2e-deployer";

function deployerAccount(): TestAccount {
	const account = seedToAccount(DEDICATED_E2E_DEPLOYER_MNEMONIC, E2E_DEPLOYER_DERIVATION);
	return {
		name: "e2e-deployer",
		suri: `${DEDICATED_E2E_DEPLOYER_MNEMONIC}${E2E_DEPLOYER_DERIVATION}`,
		address: ss58Encode(account.publicKey),
		h160: deriveH160(account.publicKey),
	};
}

export const SIGNER: TestAccount = deployerAccount();
export const ALICE: TestAccount = devAccount("Alice");
export const BOB: TestAccount = devAccount("Bob");

/**
 * Generate a unique .dot domain name for deploy tests.
 * Format mirrors `<word>-dev<NN>`.
 */
export function uniqueDomain(): string {
	const rand = Math.random().toString(36).slice(2, 6);
	const suffix = String(Date.now()).slice(-2);
	return `e2e${rand}-dev${suffix}`;
}
