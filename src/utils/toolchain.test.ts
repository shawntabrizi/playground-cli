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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prependPath } from "./toolchain.js";

describe("prependPath", () => {
    let originalPath: string | undefined;

    beforeEach(() => {
        originalPath = process.env.PATH;
    });

    afterEach(() => {
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
    });

    it("prepends the directory when not already present", () => {
        process.env.PATH = "/usr/bin:/bin";
        prependPath("/Users/me/.cargo/bin");
        expect(process.env.PATH).toBe("/Users/me/.cargo/bin:/usr/bin:/bin");
    });

    it("is a no-op when the directory is already on PATH", () => {
        process.env.PATH = "/Users/me/.cargo/bin:/usr/bin";
        prependPath("/Users/me/.cargo/bin");
        expect(process.env.PATH).toBe("/Users/me/.cargo/bin:/usr/bin");
    });

    it("handles an empty PATH", () => {
        process.env.PATH = "";
        prependPath("/Users/me/.cargo/bin");
        expect(process.env.PATH).toBe("/Users/me/.cargo/bin");
    });

    it("handles an unset PATH", () => {
        delete process.env.PATH;
        prependPath("/Users/me/.cargo/bin");
        expect(process.env.PATH).toBe("/Users/me/.cargo/bin");
    });
});
