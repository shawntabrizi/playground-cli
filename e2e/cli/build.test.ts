import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { dot } from "./helpers/dot.js";
import { fixturePath } from "./fixtures/templates.js";

describe("dot build", () => {
	const frontendOnly = fixturePath("frontend-only");
	const distDir = resolve(frontendOnly, "dist");

	beforeEach(() => {
		if (existsSync(distDir)) {
			rmSync(distDir, { recursive: true });
		}
	});

	afterEach(() => {
		if (existsSync(distDir)) {
			rmSync(distDir, { recursive: true });
		}
	});

	test("builds a frontend-only project", async () => {
		const result = await dot(["build", "--dir", frontendOnly]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Build succeeded");
		expect(existsSync(resolve(distDir, "index.html"))).toBe(true);
	});

	test("exits non-zero on build failure with error output", async () => {
		const broken = fixturePath("broken-contract");
		const result = await dot(["build", "--dir", broken]);
		expect(result.exitCode).not.toBe(0);
		// The broken-contract fixture's build script writes to stderr
		const output = result.stdout + result.stderr;
		expect(output).toMatch(/error|fail/i);
	});

	test("exits non-zero when no build strategy can be detected", async () => {
		const contractsOnly = fixturePath("contracts-only");
		const result = await dot(["build", "--dir", contractsOnly]);
		expect(result.exitCode).not.toBe(0);
		// contracts-only has no package.json — no build strategy
		const output = result.stdout + result.stderr;
		expect(output).toMatch(/no build|detect|strategy|package\.json/i);
	});
});
