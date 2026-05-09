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
