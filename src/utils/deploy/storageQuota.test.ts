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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAR_OVERHEAD_FACTOR, estimateUploadBytes } from "./storageQuota.js";

describe("estimateUploadBytes", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "playground-quota-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("sums nested file sizes and applies the CAR overhead factor", () => {
        writeFileSync(join(dir, "index.html"), "x".repeat(1000));
        mkdirSync(join(dir, "assets"));
        writeFileSync(join(dir, "assets", "app.js"), "y".repeat(2000));

        expect(estimateUploadBytes(dir)).toBe(Math.ceil(3000 * CAR_OVERHEAD_FACTOR));
    });

    it("returns 0 for an empty directory", () => {
        expect(estimateUploadBytes(dir)).toBe(0);
    });

    it("returns null for a missing directory instead of throwing", () => {
        expect(estimateUploadBytes(join(dir, "nope"))).toBeNull();
    });

    it("estimates a single file when pointed at one", () => {
        const file = join(dir, "bundle.bin");
        writeFileSync(file, "z".repeat(500));
        expect(estimateUploadBytes(file)).toBe(Math.ceil(500 * CAR_OVERHEAD_FACTOR));
    });
});
