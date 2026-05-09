// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

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
		// Must fail with a signer-resolution error. Match the exact
		// SignerNotAvailableError text from src/utils/signer.ts so a generic
		// "session" mention in an unrelated stack trace can't satisfy this.
		expect(result.exitCode).not.toBe(0);
		const output = result.stdout + result.stderr;
		expect(output).toContain("No signer available");
	});

	test("build does not create or modify session files", async () => {
		const frontendOnly = fixturePath("frontend-only");
		const sessionDir = join(tempHome, ".polkadot-apps");

		// Verify each build actually succeeds — otherwise "no session files
		// were touched" is a tautology (a crashed build can't write any file).
		const first = await dot(["build", "--dir", frontendOnly], { home: tempHome });
		expect(
			first.exitCode,
			`first build failed: ${first.stdout}\n${first.stderr}`,
		).toBe(0);
		const afterFirst = getSessionFiles(sessionDir);

		const second = await dot(["build", "--dir", frontendOnly], { home: tempHome });
		expect(
			second.exitCode,
			`second build failed: ${second.stdout}\n${second.stderr}`,
		).toBe(0);
		const afterSecond = getSessionFiles(sessionDir);

		// build doesn't need auth — no session files should be created
		expect(afterFirst).toEqual([]);
		expect(afterSecond).toEqual([]);
	});

	test("logout with no session reports no account signed in", async () => {
		const result = await dot(["logout"], { home: tempHome, timeout: 30_000 });
		expect(
			result.exitCode,
			`logout crashed: ${result.stdout}\n${result.stderr}`,
		).toBe(0);
		// Exact wording from src/commands/logout/index.ts:
		//   console.log("  No account is signed in.\n");
		expect(result.stdout).toContain("No account is signed in");
	});
});
