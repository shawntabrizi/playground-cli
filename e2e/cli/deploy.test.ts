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

describe("dot deploy — preflight and validation", () => {
	test("reports mainnet not yet supported", async () => {
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", E2E_DOMAINS.preflight,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--env", "mainnet",
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		const output = result.stdout + result.stderr;
		expect(output).toMatch(/mainnet/i);
		expect(output).toMatch(/not.*supported/i);
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
			"--suri", SIGNER.suri,
			"--dir", foundry,
		]);
		const output = result.stdout + result.stderr;
		// foundry.toml present → should not complain about missing contract project
		expect(output).not.toContain("no foundry/hardhat/cdm project was detected");
		// Should proceed to at least the availability check
		expect(output).toMatch(/checking availability|deploy/i);
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
			"--suri", SIGNER.suri,
			"--dir", hardhat,
		]);
		const output = result.stdout + result.stderr;
		expect(output).not.toContain("no foundry/hardhat/cdm project was detected");
		expect(output).toMatch(/checking availability|deploy/i);
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
			"--suri", SIGNER.suri,
			"--dir", rustCdm,
		]);
		const output = result.stdout + result.stderr;
		expect(output).not.toContain("no foundry/hardhat/cdm project was detected");
		expect(output).toMatch(/checking availability|deploy/i);
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
			"--suri", SIGNER.suri,
			"--dir", multiContract,
		]);
		const output = result.stdout + result.stderr;
		expect(output).not.toContain("no foundry/hardhat/cdm project was detected");
		expect(output).toMatch(/checking availability|deploy/i);
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
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		const output = result.stdout + result.stderr;
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
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		const output = result.stdout + result.stderr;
		expect(output).toContain("Checking availability");
		expect(output).toContain(domain);
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
	});

	test("re-deploy same domain succeeds for same owner", { timeout: 900_000 }, async () => {
		const domain = E2E_DOMAINS.redeploy;
		const first = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		expect(first.exitCode, `first deploy failed: ${first.stdout}\n${first.stderr}`).toBe(0);
		expect(first.stdout).toContain("Deploy complete");

		const second = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--no-build",
			"--playground",
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		expect(
			second.exitCode,
			`re-deploy failed: ${second.stdout}\n${second.stderr}`,
		).toBe(0);
		expect(second.stdout).toContain("Deploy complete");
	});

	test("domain taken by another account shows unavailable", { timeout: 900_000 }, async () => {
		const domain = E2E_DOMAINS.collision;
		const ownerDeploy = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
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

// SKIPPED: the rust-cdm fixture's `target/flipper.contract` is a stub
// (`{"source":{"hash":"0xabc"}}`) and there is no `target/<crate>.release.polkavm`
// for the skip-build path to read. A working fixture needs:
//   1. a real `src/lib.rs` so `cargo metadata` parses the manifest
//      (currently fails: "no targets specified in the manifest")
//   2. a committed `target/<crate>.release.polkavm` produced by an
//      actual `cargo-contract build` of a minimal flipper contract
// Tracked as Phase 5 follow-up. Until then, CDM detection is covered by
// the preflight test in `dot deploy — preflight and validation` and the
// skip-build path itself is unit-tested in `src/utils/deploy/contracts.test.ts`.
describe.skip("dot deploy — CDM (requires Paseo + IPFS)", () => {
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
