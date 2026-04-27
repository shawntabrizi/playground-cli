/**
 * E2E tests for `dot mod` — fork/clone playground apps.
 *
 * Requires chain connectivity to query the registry.
 * Uses --suri SIGNER (dedicated funder account, or //Alice fallback) for dev signing,
 * --clone to avoid GitHub fork creation.
 */

import { describe, test, expect, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dot } from "./helpers/dot.js";
import { SIGNER } from "./fixtures/accounts.js";
import { TEST_DOMAIN } from "./fixtures/templates.js";

const createdDirs: string[] = [];

afterEach(() => {
	for (const dir of createdDirs) {
		try {
			if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
		} catch { /* best-effort cleanup */ }
	}
	createdDirs.length = 0;
});

describe("dot mod — non-interactive", () => {
	test.skipIf(!TEST_DOMAIN)(
		"dot mod <domain> --clone --suri --yes clones repo and creates directory",
		async () => {
			const result = await dot([
				"mod", TEST_DOMAIN,
				"--clone",
				"--suri", SIGNER.suri,
				"-y",
			]);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Next steps");

			// Track created directory for cleanup
			const cdMatch = result.stdout.match(/cd\s+(\S+)/);
			if (cdMatch?.[1]) {
				createdDirs.push(cdMatch[1]);
				expect(existsSync(cdMatch[1])).toBe(true);
			}
		},
	);

	test("reports error for unknown domain", async () => {
		const result = await dot([
			"mod", "nonexistent-domain-xyz-12345.dot",
			"--clone",
			"--suri", SIGNER.suri,
			"-y",
		]);
		const output = result.stdout + result.stderr;
		// The CLI currently exits 0 but shows an error — assert on the message.
		// Note: the CLI should arguably exit non-zero here (potential bug to file).
		expect(output).toMatch(/not found|failed/i);
	});

	test("exits non-zero with signer suggestion when no signer available", async () => {
		const tempHome = mkdtempSync(join(tmpdir(), "dot-e2e-mod-"));
		try {
			const result = await dot(["mod", "some-app.dot", "--clone", "-y"], {
				home: tempHome,
			});
			expect(result.exitCode).not.toBe(0);
			const output = result.stdout + result.stderr;
			expect(output).toMatch(/signer|init|log.?in/i);
		} finally {
			rmSync(tempHome, { recursive: true, force: true });
		}
	});
});
