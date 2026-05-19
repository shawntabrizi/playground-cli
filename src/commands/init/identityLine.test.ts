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

import { describe, expect, it } from "vitest";
import { deriveH160, ss58Encode } from "@parity/product-sdk-address";
import { productAccountAddresses, productAccountDisplay } from "./identityLine.js";

// A deterministic, all-zero product public key gives a stable display account.
// The exact bytes don't matter; we only assert that the helper preserves the
// signer SS58, derives its H160, and renders both in the expected
// "ss58 (h160)" shape.
const ZERO_PRODUCT_PUBLIC_KEY = new Uint8Array(32);
const ZERO_PRODUCT_SS58 = ss58Encode(ZERO_PRODUCT_PUBLIC_KEY);

describe("productAccountAddresses", () => {
    it("preserves the signer SS58 and derives its H160", () => {
        const { ss58, h160 } = productAccountAddresses(ZERO_PRODUCT_SS58);
        expect(ss58).toBe(ZERO_PRODUCT_SS58);
        // Substrate SS58 addresses for a 32-byte pubkey are 47–48 chars on
        // the default ss58Format=42 prefix. Anything shorter would mean
        // we'd accidentally re-introduced truncation.
        expect(ss58.length).toBeGreaterThanOrEqual(47);
        expect(ss58).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
        expect(h160).toBe(deriveH160(ZERO_PRODUCT_PUBLIC_KEY));
    });

    it("is deterministic for the same product SS58", () => {
        const a = productAccountAddresses(ZERO_PRODUCT_SS58);
        const b = productAccountAddresses(ZERO_PRODUCT_SS58);
        expect(a.ss58).toBe(b.ss58);
        expect(a.h160).toBe(b.h160);
    });
});

describe("productAccountDisplay", () => {
    it("renders 'ss58 (h160)' with the full SS58 + full 0x-prefixed H160", () => {
        const display = productAccountDisplay(ZERO_PRODUCT_SS58);
        const match = display.match(/^([1-9A-HJ-NP-Za-km-z]+) \((0x[0-9a-fA-F]{40})\)$/);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe(ZERO_PRODUCT_SS58);
        // No ellipses anywhere — the whole point of the change is that we
        // print the full address so the user can copy it directly.
        expect(display).not.toContain("...");
    });
});
