/**
 * E2E tests for diagnostic/verbose modes.
 *
 * Tests that environment variables like DOT_DEPLOY_VERBOSE and DOT_MEMORY_TRACE
 * produce additional diagnostic output without breaking normal operation.
 */

import { describe, test, expect } from "vitest";
import { dot } from "./helpers/dot.js";
import { SIGNER } from "./fixtures/accounts.js";
import { fixturePath } from "./fixtures/templates.js";

const frontendOnly = fixturePath("frontend-only");

describe("diagnostic mode", () => {
	test("DOT_DEPLOY_VERBOSE=1 does not break deploy preflight", async () => {
		// Run a deploy that will reach preflight with verbose enabled.
		// We don't need it to succeed — just verify verbose doesn't crash anything.
		const result = await dot([
			"deploy",
			"--signer", "dev",
			"--domain", "diag-verbose-test",
			"--buildDir", "dist",
			"--playground",
			"--suri", SIGNER.suri,
			"--dir", frontendOnly,
		], {
			env: { DOT_DEPLOY_VERBOSE: "1" },
			timeout: 30_000,
		});
		const output = result.stdout + result.stderr;
		// Should reach the availability check even with verbose on
		expect(output).toMatch(/checking availability|deploy|mainnet/i);
	});

	test("DOT_MEMORY_TRACE=1 does not prevent normal operation", async () => {
		const result = await dot(["--help"], {
			env: { DOT_MEMORY_TRACE: "1" },
			timeout: 15_000,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("deploy");
	});
});
