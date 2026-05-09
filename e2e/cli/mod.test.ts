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
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
		"full clone flow: fetches source, runs setup.sh, writes dot.json",
		{ timeout: 240_000 },
		async () => {
			const cwd = makeTempDir("dot-e2e-mod-cwd-");
			const result = await dot(["mod", TEST_DOMAIN, "--suri", ALICE.suri], {
				cwd,
				timeout: 240_000,
			});

			expect(
				result.exitCode,
				`mod failed:\n${result.stdout}\n${result.stderr}`,
			).toBe(0);

			// defaultRepoName slugifies the domain and appends a 6-hex suffix.
			const slug = TEST_DOMAIN.replace(/\.dot$/, "")
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-");
			const created = readdirSync(cwd).filter(
				(name) => name.startsWith(`${slug}-`) && /-[0-9a-f]{6}$/.test(name),
			);
			expect(created).toHaveLength(1);
			const projectDir = join(cwd, created[0]!);

			// ── Step 2 (download source) — content from GitHub ─────────────
			// Asserting on multiple specific files proves the tarball was
			// actually fetched and extracted, not invented from thin air.
			// All four files are committed to paritytech/Rock-Paper-Scissors's
			// default branch — if any go missing, the upstream fixture has
			// been restructured and this test needs updating to match.
			expect(existsSync(join(projectDir, "package.json"))).toBe(true);
			expect(existsSync(join(projectDir, "README.md"))).toBe(true);
			expect(existsSync(join(projectDir, "setup.sh"))).toBe(true);
			expect(existsSync(join(projectDir, "vite.config.ts"))).toBe(true);

			// ── Step 2 side effect: writeDotJson() ─────────────────────────
			const dotJsonPath = join(projectDir, "dot.json");
			expect(existsSync(dotJsonPath)).toBe(true);
			const dotJson = JSON.parse(readFileSync(dotJsonPath, "utf-8")) as {
				domain?: string;
				name?: string;
			};
			// `domain` is set to `targetDir` in writeDotJson() — and
			// `targetDir` flows from defaultRepoName(), which returns a
			// RELATIVE slug-suffix path (e.g. `dot-cli-mod-fixture-a3b2c1`),
			// not an absolute one. So dotJson.domain should equal the leaf
			// directory name, NOT projectDir. (Field name is unusual but
			// documented in src/commands/mod/SetupScreen.tsx.)
			expect(dotJson.domain).toBe(created[0]);
			expect(dotJson.name).toBeDefined();

			// ── Step 2 side effect: ignoreModLogs() ────────────────────────
			const gitignore = readFileSync(
				join(projectDir, ".gitignore"),
				"utf-8",
			);
			expect(gitignore).toContain(".dot-mod-setup.log");
			expect(gitignore).toContain(".dot-mod-source.log");

			// ── Step 3 (run setup.sh) ──────────────────────────────────────
			// The script's first line of substantive output is
			// `echo "[setup] Rock Paper Scissors tutorial"`. If the log file
			// exists with that prefix, setup.sh actually ran. (We can't
			// assert exit 0 of the script here — exit-code propagation is
			// already covered by the outer `result.exitCode` check above.)
			const setupLog = join(projectDir, ".dot-mod-setup.log");
			expect(
				existsSync(setupLog),
				`setup.sh log not found — step 3 did not run.\n${result.stdout}\n${result.stderr}`,
			).toBe(true);
			const setupLogContent = readFileSync(setupLog, "utf-8");
			expect(setupLogContent).toContain("[setup]");
		},
	);

	test("exits non-zero with signer suggestion when no signer available", async () => {
		const tempHome = makeTempDir("dot-e2e-mod-home-");
		const cwd = makeTempDir("dot-e2e-mod-cwd-");
		const result = await dot(["mod", "some-app.dot"], { home: tempHome, cwd });
		expect(result.exitCode).not.toBe(0);
		const output = result.stdout + result.stderr;
		// Exact wording from src/utils/signer.ts SignerNotAvailableError:
		//   `No signer available. Run "dot init" to log in, or pass --suri //Alice for dev.`
		// The previous regex /signer|init|log.?in/i matched any of those words
		// anywhere — including help text — so it passed even on early crashes
		// that never reached the signer-resolution path.
		expect(output).toContain("No signer available");
		expect(output).toContain("dot init");
	});
});

describe("dot mod — registry miss", () => {
	test("reports a registry-miss for an unknown domain", { timeout: 120_000 }, async () => {
		const cwd = makeTempDir("dot-e2e-mod-unknown-");
		const domain = "nonexistent-domain-xyz-12345.dot";
		const result = await dot(
			["mod", domain, "--suri", ALICE.suri],
			{ cwd, timeout: 120_000 },
		);
		const output = result.stdout + result.stderr;
		expect(
			result.exitCode,
			`expected non-zero exit for unknown domain\n${output}`,
		).not.toBe(0);
		// Exact wording from src/commands/mod/SetupScreen.tsx:
		//   throw new Error(`App "${domain}" not found in registry`);
		// Matching both fragments rules out an unrelated "not found" landing
		// in output (e.g., a transient 404 from an IPFS gateway probe).
		expect(output).toContain(domain);
		expect(output).toContain("not found in registry");
	});
});
