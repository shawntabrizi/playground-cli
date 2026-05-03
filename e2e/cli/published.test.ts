/**
 * Smoke tests for the published SEA binary. Skipped when DOT_E2E_BINARY is
 * unset (i.e. on PR / dev runs). Exercised by the e2e-release.yml workflow
 * after downloading the SEA asset from a prerelease tag.
 *
 * Coverage scope (per spec design §11, S20a):
 *   - Binary launches and reports a sane version
 *   - Binary exits 0 on --help with the expected sections
 *
 * The keystroke-handling regression (S20-unit / Bun stdin warm-up) is
 * covered by src/index.test.ts at the source level. We deliberately do NOT
 * use a PTY here — node-pty is rejected per spec.
 */

import { describe, test, expect } from "vitest";
import { execa } from "execa";
import { getPublishedBinaryPath } from "./helpers/published-binary.js";

const binary = getPublishedBinaryPath();

describe.skipIf(!binary)("dot — published SEA binary smoke", () => {
	test("--version exits 0 with semver output", async () => {
		const result = await execa(binary!, ["--version"], { reject: false });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
	});

	test("--help exits 0 with usage section", async () => {
		const result = await execa(binary!, ["--help"], { reject: false });
		expect(result.exitCode).toBe(0);
		expect(result.stdout + result.stderr).toMatch(/Usage:/i);
	});
});
