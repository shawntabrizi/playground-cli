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

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLoginStampMs, recordLoginStamp, staleSessionWarning } from "./loginStamp.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("staleSessionWarning", () => {
    const now = 1_750_000_000_000;

    it("returns null when there is no stamp (old sessions: no heuristic, no noise)", () => {
        expect(staleSessionWarning(null, now)).toBeNull();
    });

    it("returns null for a fresh login", () => {
        expect(staleSessionWarning(now - 60 * 60 * 1000, now)).toBeNull();
    });

    it("returns null right up to the 2-day threshold", () => {
        expect(staleSessionWarning(now - 2 * DAY_MS + 1000, now)).toBeNull();
    });

    it("warns past 2 days with the logout/init remedy", () => {
        const warning = staleSessionWarning(now - 2 * DAY_MS - 1000, now);
        expect(warning).toMatch(/playground logout/);
        expect(warning).toMatch(/playground init/);
        expect(warning).toMatch(/2 days/);
    });

    it("returns null for a stamp in the future (clock skew — do not warn)", () => {
        expect(staleSessionWarning(now + DAY_MS, now)).toBeNull();
    });
});

describe("recordLoginStamp / readLoginStampMs", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "playground-login-stamp-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("round-trips the login timestamp", async () => {
        await recordLoginStamp(1_750_000_000_000, dir);
        await expect(readLoginStampMs(dir)).resolves.toBe(1_750_000_000_000);
    });

    it("returns null when no stamp exists", async () => {
        await expect(readLoginStampMs(dir)).resolves.toBeNull();
    });

    it("returns null on a corrupt stamp instead of throwing", async () => {
        writeFileSync(join(dir, "dot-cli_LoginStamp.json"), "not json");
        await expect(readLoginStampMs(dir)).resolves.toBeNull();
    });

    it("recordLoginStamp never throws, even when the directory is unwritable", async () => {
        // Recording is best-effort telemetry for the staleness heuristic; it
        // must never break the login flow. Use a regular FILE as the target
        // "directory": mkdir/writeFile fail with ENOTDIR under any uid (a
        // path under / would actually be writable when running as root).
        const blocker = join(dir, "not-a-directory");
        writeFileSync(blocker, "occupied");
        await expect(recordLoginStamp(Date.now(), join(blocker, "child"))).resolves.toBeUndefined();
    });
});
