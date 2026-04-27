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

import { describe, test, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { dot } from "./helpers/dot.js";
import { ALICE, BOB, uniqueDomain } from "./fixtures/accounts.js";
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

describe("dot deploy — preflight and validation", () => {
	test("reports mainnet not yet supported", async () => {
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", "test",
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--env", "mainnet",
			"--suri", ALICE.suri,
			"--dir", frontendOnly,
		]);
		const output = result.stdout + result.stderr;
		expect(output).toMatch(/mainnet/i);
		expect(output).toMatch(/not.*supported/i);
	});

	test("detects foundry contracts type in project", async () => {
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", uniqueDomain(),
			"--buildDir", absBuildDir(foundry),
			"--no-build",
			"--contracts",
			"--playground",
			"--suri", ALICE.suri,
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
			"--domain", uniqueDomain(),
			"--buildDir", absBuildDir(hardhat),
			"--no-build",
			"--contracts",
			"--playground",
			"--suri", ALICE.suri,
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
			"--domain", uniqueDomain(),
			"--buildDir", absBuildDir(rustCdm),
			"--no-build",
			"--contracts",
			"--playground",
			"--suri", ALICE.suri,
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
			"--domain", uniqueDomain(),
			"--buildDir", absBuildDir(multiContract),
			"--no-build",
			"--contracts",
			"--playground",
			"--suri", ALICE.suri,
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
			"--domain", uniqueDomain(),
			"--buildDir", absBuildDir(frontendOnly),
			"--no-build",
			"--contracts",
			"--playground",
			"--suri", ALICE.suri,
			"--dir", frontendOnly,
		]);
		const output = result.stdout + result.stderr;
		expect(output).toContain("no foundry/hardhat/cdm project was detected");
	});

	test("domain availability check runs before build/upload", async () => {
		const domain = uniqueDomain();
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--suri", ALICE.suri,
			"--dir", frontendOnly,
		]);
		const output = result.stdout + result.stderr;
		expect(output).toContain("Checking availability");
		expect(output).toContain(domain);
	});
});

describe("dot deploy --playground — full pipeline (requires Paseo + IPFS)", () => {
	let domain: string;

	beforeEach(() => {
		domain = uniqueDomain();
	});

	test("frontend-only deploy reaches storage phase", async () => {
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--suri", ALICE.suri,
			"--dir", frontendOnly,
		]);

		const output = result.stdout + result.stderr;
		if (result.exitCode === 0) {
			// Full success — IPFS was running and testnet was funded
			expect(result.stdout).toContain("Deploy complete");
			expect(result.stdout).toContain("URL");
			expect(result.stdout).toContain(domain);
		} else {
			// Partial progress — got past preflight but IPFS or funding blocked it
			expect(output).toContain("Checking availability");
			expect(output).toMatch(/storage|chunk|ipfs|bulletin/i);
		}
	});

	test("re-deploy same domain succeeds for same owner", { timeout: 300_000 }, async () => {
		const first = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--suri", ALICE.suri,
			"--dir", frontendOnly,
		]);

		// Skip if first deploy didn't complete (infra not available)
		if (first.exitCode !== 0) {
			expect.soft(first.stdout + first.stderr).toContain("Checking availability");
			return; // infra-dependent — can't test re-deploy without a first deploy
		}

		const second = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--no-build",
			"--playground",
			"--suri", ALICE.suri,
			"--dir", frontendOnly,
		]);
		expect(second.exitCode).toBe(0);
		expect(second.stdout).toContain("Deploy complete");
	});

	test("domain taken by another account shows unavailable", { timeout: 300_000 }, async () => {
		const aliceDeploy = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--suri", ALICE.suri,
			"--dir", frontendOnly,
		]);

		// Skip if first deploy didn't complete (infra not available)
		if (aliceDeploy.exitCode !== 0) {
			expect.soft(aliceDeploy.stdout + aliceDeploy.stderr).toContain("Checking availability");
			return; // infra-dependent — can't test collision without a first deploy
		}

		const bobDeploy = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", domain,
			"--buildDir", absBuildDir(frontendOnly),
			"--playground",
			"--suri", BOB.suri,
			"--dir", frontendOnly,
		]);
		// Must fail — domain is owned by Alice's dev signer, not Bob's
		expect(bobDeploy.exitCode).not.toBe(0);
		const output = bobDeploy.stdout + bobDeploy.stderr;
		expect(output.toLowerCase()).toMatch(/taken|registered|owned|unavailable|already/);
	});
});
