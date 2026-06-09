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

import { describe, it, expect } from "vitest";

import { isFullySpecified, shouldResolveUserSigner } from "./index.js";

describe("shouldResolveUserSigner", () => {
    it("skips signer lookup for pure dev deploys", () => {
        expect(shouldResolveUserSigner({ mode: "dev" })).toBe(false);
    });

    it("loads the logged-in signer for dev deploys that publish to playground", () => {
        expect(shouldResolveUserSigner({ mode: "dev", publishToPlayground: true })).toBe(true);
    });

    it("loads a signer for phone mode", () => {
        expect(shouldResolveUserSigner({ mode: "phone" })).toBe(true);
    });

    it("loads a signer when a suri is supplied", () => {
        expect(shouldResolveUserSigner({ mode: "dev", suri: "//Alice" })).toBe(true);
    });
});

describe("isFullySpecified", () => {
    const fullySpecified = {
        signer: "phone",
        domain: "my-app",
        buildDir: "dist",
        playground: true,
    } as const;

    it("keeps deploy interactive when the contracts answer is omitted", () => {
        expect(isFullySpecified(fullySpecified)).toBe(false);
    });

    it("allows headless deploy when contracts are explicitly enabled", () => {
        expect(isFullySpecified({ ...fullySpecified, contracts: true })).toBe(true);
    });

    it("allows headless deploy when contracts are explicitly skipped", () => {
        expect(isFullySpecified({ ...fullySpecified, contracts: false })).toBe(true);
    });
});
