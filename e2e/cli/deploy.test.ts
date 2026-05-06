/**
 * E2E tests for `dot deploy`.
 *
 * These tests verify the deploy pipeline behavior. Tests that require
 * full network connectivity (Paseo testnet + IPFS) are marked accordingly.
 *
 * All headless deploys require: --signer, --domain, --buildDir, --playground
 * to trigger the non-interactive path (see isFullySpecified() in deploy/index.ts).
 *
 * Developer-requested priorities:
 * - Projects with multiple contracts (multi-contract fixture)
 * - EVM (Foundry/Hardhat) vs PVM (Rust/CDM) backends
 * - The --contracts flag
 */

import { describe, test, expect } from "vitest";
import { resolve } from "node:path";
import { dot } from "./helpers/dot.js";
import { SIGNER, BOB, E2E_DOMAINS } from "./fixtures/accounts.js";
import { fixturePath } from "./fixtures/templates.js";
import { getApp } from "./fixtures/registry.js";

/** Pull the metadata CID out of the headless deploy summary. The CLI
 *  prints `  Metadata CID    bafy...` once per successful deploy
 *  (see src/commands/deploy/index.ts printFinalResult). Returns null
 *  if absent — that itself is a meaningful signal. */
function extractMetadataCid(stdout: string): string | null {
	const m = stdout.match(/Metadata CID\s+(\S+)/);
	return m ? m[1] : null;
}

const frontendOnly = fixturePath("frontend-only");
const foundry = fixturePath("foundry");
const hardhat = fixturePath("hardhat");
const rustCdm = fixturePath("rust-cdm");
const multiContract = fixturePath("multi-contract");

/** buildDir must be absolute — it's resolved relative to cwd, not --dir */
function absBuildDir(fixture: string, dir = "dist"): string {
	return resolve(fixture, dir);
}

/**
 * Shared helper for contract-deploy end-to-end tests.
 *
 * `--no-contract-build` skips the toolchain subprocess (forge / npx hardhat
 * compile / cargo-contract) so the CI runner doesn't need the EVM/Rust
 * toolchain installed. Each fixture ships pre-built bytecode in its out/ or
 * artifacts/ directory.
 */
interface ContractDeployTestConfig {
	/** describe-block discriminator: "foundry", "hardhat", "multi" */
	name: string;
	/** E2E_DOMAINS.<name> */
	domain: string;
	/** fixturePath() result */
	fixture: string;
}

function runContractDeployTest(cfg: ContractDeployTestConfig): void {
	describe(`dot deploy — ${cfg.name} (requires Paseo + IPFS)`, () => {
		test(`${cfg.name} deploy completes end-to-end`, { timeout: 450_000 }, async () => {
			const result = await dot([
				"deploy",
				"--signer", "dev",
				"--domain", cfg.domain,
				"--buildDir", absBuildDir(cfg.fixture),
				"--contracts",
				"--no-contract-build",
				"--playground",
				"--private",
				"--suri", SIGNER.suri,
				"--dir", cfg.fixture,
			], { timeout: 400_000 });

			expect(
				result.exitCode,
				`${cfg.name} deploy failed: ${result.stdout}\n${result.stderr}`,
			).toBe(0);
			expect(result.stdout).toContain("Deploy complete");
			expect(result.stdout).toContain(cfg.domain);
		});
	});
}

/**
 * Assertion notes for the preflight tests below:
 * - "Checking availability" is printed by `src/commands/deploy/index.ts` ONLY
 *   after preflight (signer + mapping + balance) has succeeded. Asserting on
 *   it is a real checkpoint — a deploy that crashes earlier won't print it.
 * - Avoid loose regexes like `/deploy/i`: the literal word "deploy" appears
 *   in the command banner, error-help text, and stack traces, so it matches
 *   even when nothing meaningful happened.
 * - For tests that expect failure, assert `exitCode !== 0` so an early crash
 *   that prints something tangentially matching the regex can't slip through.
 */

describe("dot deploy — preflight and validation", () => {
	test("reports mainnet not yet supported", async () => {
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", E2E_DOMAINS.preflight,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--private",
			"--env", "mainnet",
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		const output = result.stdout + result.stderr;
		expect(
			result.exitCode,
			`expected non-zero exit for --env mainnet, got 0\n${output}`,
		).not.toBe(0);
		// Exact wording from src/commands/deploy/index.ts: "`--env mainnet` is
		// not yet supported. Use `--env testnet` (default) while mainnet launch
		// is pending."
		expect(output).toContain("not yet supported");
		expect(output).toContain("--env testnet");
	});

	test("detects foundry contracts type in project", async () => {
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", E2E_DOMAINS.preflight,
			"--buildDir", absBuildDir(foundry),
			"--no-build",
			"--contracts",
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", foundry,
		]);
		const output = result.stdout + result.stderr;
		// foundry.toml present → should not complain about missing contract project
		expect(output).not.toContain("no foundry/hardhat/cdm project was detected");
		// Real checkpoint: only printed after preflight succeeds.
		expect(
			output,
			`expected to reach availability check\n${output}`,
		).toContain("Checking availability");
	});

	test("detects hardhat contracts type in project", async () => {
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", E2E_DOMAINS.preflight,
			"--buildDir", absBuildDir(hardhat),
			"--no-build",
			"--contracts",
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", hardhat,
		]);
		const output = result.stdout + result.stderr;
		expect(output).not.toContain("no foundry/hardhat/cdm project was detected");
		expect(
			output,
			`expected to reach availability check\n${output}`,
		).toContain("Checking availability");
	});

	test("detects CDM/Rust contracts type in project", async () => {
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", E2E_DOMAINS.preflight,
			"--buildDir", absBuildDir(rustCdm),
			"--no-build",
			"--contracts",
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", rustCdm,
		]);
		const output = result.stdout + result.stderr;
		expect(output).not.toContain("no foundry/hardhat/cdm project was detected");
		expect(
			output,
			`expected to reach availability check\n${output}`,
		).toContain("Checking availability");
	});

	test("detects multiple contracts in multi-contract project", async () => {
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", E2E_DOMAINS.preflight,
			"--buildDir", absBuildDir(multiContract),
			"--no-build",
			"--contracts",
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", multiContract,
		]);
		const output = result.stdout + result.stderr;
		expect(output).not.toContain("no foundry/hardhat/cdm project was detected");
		expect(
			output,
			`expected to reach availability check\n${output}`,
		).toContain("Checking availability");
	});

	test("--contracts reports error when no contract project detected", async () => {
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", E2E_DOMAINS.preflight,
			"--buildDir", absBuildDir(frontendOnly),
			"--no-build",
			"--contracts",
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		const output = result.stdout + result.stderr;
		expect(
			result.exitCode,
			`expected non-zero exit when --contracts has no project\n${output}`,
		).not.toBe(0);
		expect(output).toContain("no foundry/hardhat/cdm project was detected");
	});

	test("domain availability check runs before build/upload", { timeout: 300_000 }, async () => {
		const domain = E2E_DOMAINS.preflight;
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		const output = result.stdout + result.stderr;
		// Availability banner names the domain; this is the strongest signal we
		// have that the availability check actually executed against this run's
		// domain (rather than echoing the arg in a usage/error string).
		const availIdx = output.indexOf(`Checking availability of ${domain}.dot`);
		expect(
			availIdx,
			`availability banner not found:\n${output}`,
		).toBeGreaterThan(-1);
		// Verify the *ordering* claim in the test name: availability must
		// precede any build-runner output. The dot CLI's build banner is
		// `\n> ${config.description}\n` from src/commands/build.ts:15, and
		// `config.description` is always one of `pnpm/npm/yarn/bun/npx <verb>`
		// (see src/utils/build/detect.ts). Anchoring on that exact prefix
		// avoids matching unrelated `> ` lines that build-tool stdout itself
		// can produce — pnpm prints `> @scope/pkg@1 build /path` for every
		// run-script, vite logs `> built in 234ms`, etc.
		const buildIdx = output.search(/\n> (?:pnpm|npm|yarn|bun|npx) /);
		const storageIdx = output.indexOf("▸ storage-and-dotns");
		if (buildIdx > -1) {
			expect(
				availIdx,
				`build header appeared before availability check:\n${output}`,
			).toBeLessThan(buildIdx);
		}
		if (storageIdx > -1) {
			expect(
				availIdx,
				`storage phase started before availability check:\n${output}`,
			).toBeLessThan(storageIdx);
		}
	});
});

describe("dot deploy --playground — full pipeline (requires Paseo + IPFS)", () => {
	test("frontend-only deploy completes end-to-end", { timeout: 450_000 }, async () => {
		const domain = E2E_DOMAINS.storage;
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });

		expect(
			result.exitCode,
			`deploy failed: ${result.stdout}\n${result.stderr}`,
		).toBe(0);
		expect(result.stdout).toContain("Deploy complete");
		expect(result.stdout).toContain("URL");
		expect(result.stdout).toContain(domain);

		// Don't trust the CLI's own success message — query the registry
		// independently to prove the entry was actually written. A regression
		// where deploy prints "Deploy complete" but never sends the registry
		// extrinsic would otherwise pass.
		const cliCid = extractMetadataCid(result.stdout);
		expect(cliCid, "CLI did not print Metadata CID").not.toBeNull();
		const entry = await getApp(`${domain}.dot`);
		expect(entry, `registry has no entry for ${domain}.dot`).not.toBeNull();
		// Belt-and-braces: the on-chain CID should match what the CLI claims
		// it published. A divergence here means the CLI is reporting one CID
		// to the user while writing a different one to the chain.
		expect(entry!.metadataUri).toContain(cliCid!);
	});

	test("re-deploy same domain succeeds for same owner", { timeout: 900_000 }, async () => {
		const domain = E2E_DOMAINS.redeploy;
		const first = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		expect(first.exitCode, `first deploy failed: ${first.stdout}\n${first.stderr}`).toBe(0);
		expect(first.stdout).toContain("Deploy complete");
		const firstCid = extractMetadataCid(first.stdout);
		expect(firstCid, "first deploy did not print Metadata CID").not.toBeNull();

		const second = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--no-build",
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		expect(
			second.exitCode,
			`re-deploy failed: ${second.stdout}\n${second.stderr}`,
		).toBe(0);
		expect(second.stdout).toContain("Deploy complete");
		const secondCid = extractMetadataCid(second.stdout);
		expect(secondCid, "re-deploy did not print Metadata CID").not.toBeNull();
		// NOTE: do NOT assert `secondCid !== firstCid`. The metadata JSON only
		// includes `{repository, readme}` (see buildMetadata in src/utils/
		// deploy/playground.ts) — neither changes on a same-fixture redeploy,
		// so the CID is content-addressed to the same value both times. That's
		// correct behaviour: a same-CID re-publish means the registry already
		// has what the user wants.
		//
		// Independent registry check: the on-chain entry must contain the CID
		// the CLI claims it published. This catches regressions where the CLI
		// prints "Deploy complete" but never sent the registry extrinsic.
		const entry = await getApp(`${domain}.dot`);
		expect(entry).not.toBeNull();
		expect(entry!.metadataUri).toContain(secondCid!);
	});

	test("domain taken by another account shows unavailable", { timeout: 900_000 }, async () => {
		const domain = E2E_DOMAINS.collision;
		const ownerDeploy = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		expect(
			ownerDeploy.exitCode,
			`owner deploy failed: ${ownerDeploy.stdout}\n${ownerDeploy.stderr}`,
		).toBe(0);

		const bobDeploy = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--private",
			"--suri", BOB.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		// Must fail — domain is owned by SIGNER, not Bob.
		const output = bobDeploy.stdout + bobDeploy.stderr;
		expect(
			bobDeploy.exitCode,
			`bob deploy unexpectedly succeeded: ${bobDeploy.stdout}\n${bobDeploy.stderr}`,
		).not.toBe(0);
		expect(output.toLowerCase()).toMatch(/revert|taken|registered|owned|unavailable|already/);
	});
});

// Contract-deploy tests — parametrized via runContractDeployTest
runContractDeployTest({ name: "foundry", domain: E2E_DOMAINS.foundry, fixture: foundry });
runContractDeployTest({ name: "hardhat", domain: E2E_DOMAINS.hardhat, fixture: hardhat });
// Multi-contract foundry project — exercises the contracts-batch publish path
// (TokenA.sol + TokenB.sol deployed in a single --contracts run).
runContractDeployTest({ name: "multi", domain: E2E_DOMAINS.multi, fixture: multiContract });

// Rejection test — does NOT require Paseo or IPFS; exits before any chain mutation.
describe("dot deploy — rejects --no-contract-build with no artefacts", () => {
	test("foundry project with --no-contract-build but no out/ → clear error", { timeout: 120_000 }, async () => {
		const constructorArgs = fixturePath("constructor-args");
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", E2E_DOMAINS.preflight,
			"--buildDir", absBuildDir(constructorArgs),
			"--contracts",
			"--no-contract-build",
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", constructorArgs,
		]);
		const output = result.stdout + result.stderr;
		expect(result.exitCode).not.toBe(0);
		expect(output).toMatch(/no pre-built contract artifacts found/i);
		expect(output).toMatch(/--no-contract-build/);
	});
});

// CDM follows the same CI shape as foundry/hardhat: deploy pre-built artifacts
// committed with the fixture, without requiring the Rust/PVM toolchain on CI.
describe("dot deploy — cdm (requires Paseo + IPFS)", () => {
	test("CDM deploy completes end-to-end", { timeout: 450_000 }, async () => {
		const domain = E2E_DOMAINS.cdm;
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(rustCdm),
			"--contracts",
			"--no-contract-build",
			"--playground",
			"--private",
			"--suri", SIGNER.suri,
			"--dir", rustCdm,
		], { timeout: 400_000 });

		expect(
			result.exitCode,
			`CDM deploy failed: ${result.stdout}\n${result.stderr}`,
		).toBe(0);
		expect(result.stdout).toContain("Deploy complete");
		expect(result.stdout).toContain(domain);
	});
});
