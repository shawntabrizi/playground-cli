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
import { ss58Encode } from "@parity/product-sdk-address";
import { deriveProductAccountPublicKey } from "@parity/product-sdk-keys";
import { PLAYGROUND_PRODUCT_ID } from "../config.js";

describe("product account integration", () => {
    it("derives a stable SS58 address for playground.dot / index 0 from a fixed root", () => {
        const root = new Uint8Array(32).fill(0);
        const pubkey = deriveProductAccountPublicKey(root, PLAYGROUND_PRODUCT_ID, 0);
        const address = ss58Encode(pubkey);
        // The algorithm is locked by upstream frozen vectors in @parity/product-sdk-keys;
        // here we only assert that wiring (config + sdk import + ss58Encode) does
        // not silently produce an empty/malformed address.
        expect(typeof address).toBe("string");
        expect(address.length).toBeGreaterThan(40);
        expect(pubkey.length).toBe(32);
    });
});
