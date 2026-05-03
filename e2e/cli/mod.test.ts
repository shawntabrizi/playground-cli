/**
 * E2E tests for `dot mod`.
 *
 * `dot mod <domain>` is fully non-interactive when a domain is supplied:
 * the AppBrowser picker is skipped, and SetupScreen runs StepRunner with
 * no `useInput`. So passing `--suri //Alice` is enough — there's no
 * `--yes` to skip a prompt because there's no prompt left.
 *
 * Requires chain connectivity (registry) and GitHub access (codeload
 * tarball download) for the happy path.
 */

import { describe, test, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dot } from "./helpers/dot.js";
import { ALICE } from "./fixtures/accounts.js";
import { TEST_DOMAIN } from "./fixtures/templates.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs) {
		try {
			if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
		} catch { /* best-effort cleanup */ }
	}
	tempDirs.length = 0;
});

describe("dot mod — clone", () => {
	test.skipIf(!TEST_DOMAIN)(
		"clones the registered template into a fresh directory",
		{ timeout: 180_000 },
		async () => {
			const cwd = makeTempDir("dot-e2e-mod-cwd-");
			const result = await dot(["mod", TEST_DOMAIN, "--suri", ALICE.suri], {
				cwd,
				timeout: 180_000,
			});

			expect(result.exitCode).toBe(0);
			// defaultRepoName slugifies the domain and appends a 6-hex suffix.
			const slug = TEST_DOMAIN.replace(/\.dot$/, "")
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-");
			const created = readdirSync(cwd).filter(
				(name) => name.startsWith(`${slug}-`) && /-[0-9a-f]{6}$/.test(name),
			);
			expect(created).toHaveLength(1);
			expect(existsSync(join(cwd, created[0]!, "package.json"))).toBe(true);
		},
	);

	test("exits non-zero with signer suggestion when no signer available", async () => {
		const tempHome = makeTempDir("dot-e2e-mod-home-");
		const cwd = makeTempDir("dot-e2e-mod-cwd-");
		const result = await dot(["mod", "some-app.dot"], { home: tempHome, cwd });
		expect(result.exitCode).not.toBe(0);
		const output = result.stdout + result.stderr;
		expect(output).toMatch(/signer|init|log.?in/i);
	});
});

describe("dot mod — registry miss", () => {
	test("reports a registry-miss for an unknown domain", async () => {
		const cwd = makeTempDir("dot-e2e-mod-unknown-");
		const result = await dot(
			["mod", "nonexistent-domain-xyz-12345.dot", "--suri", ALICE.suri],
			{ cwd },
		);
		const output = result.stdout + result.stderr;
		expect(result.exitCode).not.toBe(0);
		expect(output).toMatch(/not found/i);
	});
});
