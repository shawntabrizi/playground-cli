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
 * Fixed `.dot` domain names for deploy tests. SIGNER owns all of these after
 * the first CI run; subsequent runs re-publish to the same domains, which the
 * registry contract permits for the same owner. This keeps the playground
 * registry from accumulating a new entry on every CI run.
 *
 * Use a separate domain per test that exercises a meaningfully different
 * publish path (storage / re-deploy / cross-owner collision); reuse a single
 * domain for the preflight / validation tests.
 *
 * NOTE: do not assert on the registry state of `preflight` — it's shared by
 * six tests in the same file and the metadata at any moment reflects whichever
 * one ran last. Stdout assertions are fine. If you need to assert on registry
 * state for a new test, give it its own dedicated domain here.
 */
export const E2E_DOMAINS = {
	/**
	 * Shared by the validation tests in `dot deploy — preflight and validation`.
	 * `--no-build` only skips the build step, not the publish — so some of these
	 * tests do reach `registry.publish`. SIGNER ends up owning this domain
	 * regardless; subsequent runs are same-owner re-publishes.
	 */
	preflight: "e2e-cli-preflight",
	/** Used by the storage-phase happy path. */
	storage: "e2e-cli-storage",
	/** Used by the same-owner re-deploy test. */
	redeploy: "e2e-cli-redeploy",
	/** Used by the cross-owner collision test (BOB tries to take SIGNER's). */
	collision: "e2e-cli-collision",
} as const;
