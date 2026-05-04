import { describe, test, expect, afterEach } from "vitest";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { dot } from "./helpers/dot.js";
import { fixturePath } from "./fixtures/templates.js";

/**
 * Copy a fixture into a fresh temp dir so the build output lives there,
 * not inside the source-controlled fixture. This keeps build.test.ts
 * order-independent: previously we deleted `frontend-only/dist` between
 * tests, which left the dir absent for any later test that ran with
 * `--no-build` (deploy, diagnostic). With a copy, the original fixture
 * is never touched.
 */
function stageFixture(name: string): string {
	const dir = mkdtempSync(join(tmpdir(), `dot-e2e-build-${name}-`));
	cpSync(fixturePath(name), dir, { recursive: true });
	return dir;
}

describe("dot build", () => {
	const stagedDirs: string[] = [];

	afterEach(() => {
		for (const d of stagedDirs) {
			try {
				rmSync(d, { recursive: true, force: true });
			} catch { /* best-effort */ }
		}
		stagedDirs.length = 0;
	});

	function stage(name: string): string {
		const d = stageFixture(name);
		stagedDirs.push(d);
		return d;
	}

	test("builds a frontend-only project", async () => {
		const project = stage("frontend-only");
		// The fixture ships a pre-built dist for use by deploy tests.
		// Remove it from the staged copy so we can assert that *this*
		// build invocation produced the artifacts.
		const distDir = resolve(project, "dist");
		if (existsSync(distDir)) rmSync(distDir, { recursive: true });

		const result = await dot(["build", "--dir", project]);
		expect(
			result.exitCode,
			`build failed: ${result.stdout}\n${result.stderr}`,
		).toBe(0);
		expect(result.stdout).toContain("Build succeeded");
		expect(existsSync(resolve(distDir, "index.html"))).toBe(true);
	});

	test("exits non-zero on build failure with error output", async () => {
		const project = stage("broken-contract");
		const result = await dot(["build", "--dir", project]);
		expect(result.exitCode).not.toBe(0);
		// The fixture's package.json runs:
		//   "build": "echo 'Compile error: unexpected token' >&2 && exit 1"
		// Match the exact text — proves the runner invoked the user's script
		// and surfaced its stderr, not just any pipeline-level error.
		const output = result.stdout + result.stderr;
		expect(output).toContain("Compile error: unexpected token");
	});

	test("exits non-zero when no build strategy can be detected", async () => {
		const project = stage("contracts-only");
		const result = await dot(["build", "--dir", project]);
		expect(result.exitCode).not.toBe(0);
		// Exact wording from src/utils/build/detect.ts:
		//   `No build strategy detected. Add a "build" script to package.json,
		//    or install vite/next/typescript.`
		const output = result.stdout + result.stderr;
		expect(output).toContain("No build strategy detected");
	});
});
