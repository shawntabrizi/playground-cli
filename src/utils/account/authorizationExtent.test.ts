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
import { remainingAuthorizationExtent } from "./authorizationExtent.js";

describe("remainingAuthorizationExtent", () => {
    it("subtracts used quota from granted allowance", () => {
        expect(
            remainingAuthorizationExtent({
                transactions: 250,
                transactions_allowance: 1000,
                bytes: 12_500_000n,
                bytes_allowance: 100_000_000n,
            }),
        ).toEqual({
            transactions: 750,
            bytes: 87_500_000n,
        });
    });

    it("treats zero usage as full remaining allowance", () => {
        expect(
            remainingAuthorizationExtent({
                transactions: 0,
                transactions_allowance: 3000,
                bytes: 0n,
                bytes_allowance: 300_000_000n,
            }),
        ).toEqual({
            transactions: 3000,
            bytes: 300_000_000n,
        });
    });

    it("clamps over-consumed quota at zero", () => {
        expect(
            remainingAuthorizationExtent({
                transactions: 1001,
                transactions_allowance: 1000,
                bytes: 101_000_000n,
                bytes_allowance: 100_000_000n,
            }),
        ).toEqual({
            transactions: 0,
            bytes: 0n,
        });
    });

    it("rejects legacy extents without current allowance fields", () => {
        expect(() =>
            remainingAuthorizationExtent({
                transactions: 1000,
                bytes: 100_000_000n,
            }),
        ).toThrow(/transactions_allowance/);
    });
});
