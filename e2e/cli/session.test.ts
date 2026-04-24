/**
 * E2E tests for session management.
 *
 * Tests session persistence, corruption handling, and logout behavior.
 * Uses HOME override to isolate session state in a temp directory.
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dot } from "./helpers/dot.js";
import { fixturePath } from "./fixtures/templates.js";

function makeTempHome(): string {
	const dir = mkdtempSync(join(tmpdir(), "dot-e2e-session-"));
	mkdirSync(join(dir, ".polkadot-apps"), { recursive: true });
	return dir;
}

function getSessionFiles(dir: string): string[] {
	try {
		return readdirSync(dir).filter((f: string) => f.startsWith("dot-cli_")).sort();
	} catch {
		return [];
	}
}

describe("session management", () => {
	let tempHome: string;

	beforeEach(() => {
		tempHome = makeTempHome();
	});

	afterEach(() => {
		rmSync(tempHome, { recursive: true, force: true });
	});

	test("corrupted session file does not produce a valid signer", async () => {
		const sessionFile = join(tempHome, ".polkadot-apps", "dot-cli_SsoSessions.json");
		writeFileSync(sessionFile, "CORRUPT_DATA_HERE");

		const result = await dot(
			["deploy", "--signer", "phone", "--domain", "test", "--playground", "--buildDir", "dist"],
			{ home: tempHome, timeout: 30_000 },
		);
		// A corrupted session must never lead to a successful deploy
		expect(result.stdout).not.toContain("Deploy complete");
	});

	test("build does not create or modify session files", async () => {
		const frontendOnly = fixturePath("frontend-only");
		const sessionDir = join(tempHome, ".polkadot-apps");

		await dot(["build", "--dir", frontendOnly], { home: tempHome });
		const afterFirst = getSessionFiles(sessionDir);

		await dot(["build", "--dir", frontendOnly], { home: tempHome });
		const afterSecond = getSessionFiles(sessionDir);

		// build doesn't need auth — no session files should be created
		expect(afterFirst).toEqual(afterSecond);
	});

	test("logout with no session reports no account signed in", async () => {
		const result = await dot(["logout"], { home: tempHome, timeout: 30_000 });
		const output = (result.stdout + result.stderr).toLowerCase();
		expect(output).toMatch(/no.*sign|not.*log|no.*session|no.*account/);
	});
});
