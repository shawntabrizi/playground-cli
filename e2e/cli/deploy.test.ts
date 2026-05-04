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
import { readFileSync, writeFileSync } from "node:fs";
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

	test("--contracts works on a multi-contract project", async () => {
		// Renamed from "detects multiple contracts" — the headless logger
		// (logHeadlessEvent in src/commands/deploy/index.ts) does not
		// surface the per-contract names that compile-detected events
		// carry, so the CLI output cannot prove plurality. We can only
		// prove the contract-type detector accepted the project. If
		// per-contract names get logged in headless mode in future, add
		// `expect(output).toContain("TokenA")` + `"TokenB"` here.
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
		// precede any build-runner output. Without this, the test only proves
		// availability ran, not that it ran first. Build runners emit the
		// header `> <strategy description>` (see src/commands/build.ts:14)
		// and bulletin-deploy's storage phase emits `▸ storage-and-dotns…`
		// (logHeadlessEvent). Either appearing before availability would
		// break the contract.
		const buildIdx = output.search(/\n>\s+\w/);
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
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], { timeout: 400_000 });
		expect(first.exitCode, `first deploy failed: ${first.stdout}\n${first.stderr}`).toBe(0);
		expect(first.stdout).toContain("Deploy complete");
		const firstCid = extractMetadataCid(first.stdout);
		expect(firstCid, "first deploy did not print Metadata CID").not.toBeNull();

		// Mutate the build output between the two deploys so the second
		// deploy must produce a DIFFERENT metadata CID. Without this, a
		// regression where the second deploy silently no-ops (returns the
		// previous result without re-publishing) would still print
		// "Deploy complete" with the old CID and the test would pass.
		const indexHtml = resolve(absBuildDir(frontendOnly), "index.html");
		const original = readFileSync(indexHtml, "utf8");
		writeFileSync(
			indexHtml,
			`${original}\n<!-- redeploy marker ${Date.now()} -->\n`,
		);

		try {
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
			const secondCid = extractMetadataCid(second.stdout);
			expect(secondCid, "re-deploy did not print Metadata CID").not.toBeNull();
			// Different content → different metadata CID. If these match,
			// the second deploy didn't actually re-publish.
			expect(
				secondCid,
				`re-deploy produced same CID as first — content didn't change on chain`,
			).not.toBe(firstCid);
			// And the registry should reflect the latest publish.
			const entry = await getApp(`${domain}.dot`);
			expect(entry).not.toBeNull();
			expect(entry!.metadataUri).toContain(secondCid!);
		} finally {
			// Restore so subsequent tests see the original fixture content.
			writeFileSync(indexHtml, original);
		}
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
		// Exact wording from src/utils/deploy/availability.ts:
		//   "{domain}.dot is already registered by {owner} — transfer it or use
		//    a different name"
		// The previous /revert|taken|registered|owned|unavailable|already/
		// regex matched any of those words anywhere — including transient
		// network errors and unrelated runtime stack traces — so it could not
		// distinguish "Bob hit the right ownership conflict" from "Bob hit
		// some other failure that happened to mention 'registered'".
		expect(output).toContain("already registered");
		expect(output).toContain(domain);
	});
});
