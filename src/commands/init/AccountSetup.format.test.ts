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
 * Covers the bigint-safe display formatters used by AccountSetup.
 *
 * The component itself is tested via manual QA + the render smoke path;
 * these helpers are pure, so we test them in isolation.
 */

import { describe, it, expect } from "vitest";
import { formatPas, formatMb } from "./AccountSetup.js";

describe("formatPas", () => {
    it("formats zero as '0.00 PAS'", () => {
        expect(formatPas(0n)).toBe("0.00 PAS");
    });

    it("formats whole PAS amounts with two decimals", () => {
        expect(formatPas(10_000_000_000n)).toBe("1.00 PAS");
        expect(formatPas(100_000_000_000n)).toBe("10.00 PAS");
    });

    it("formats fractional PAS amounts correctly", () => {
        // 1.5 PAS = 15_000_000_000 planck
        expect(formatPas(15_000_000_000n)).toBe("1.50 PAS");
        // 0.01 PAS = 100_000_000 planck
        expect(formatPas(100_000_000n)).toBe("0.01 PAS");
    });

    it("stays exact above 2^53 planck (no lossy Number(bigint))", () => {
        // 9_007_199_254_740_993n is 2^53 + 1 — Number(that) loses precision.
        // Divided by 10^10 planck/PAS → whole = 900_719n, remainder = 9_254_740_993.
        // Two-decimal fraction = 9_254_740_993 / 10^8 = 92.
        const huge = 9_007_199_254_740_993n;
        expect(formatPas(huge)).toBe("900719.92 PAS");
    });
});

describe("formatMb", () => {
    it("renders integer MB", () => {
        expect(formatMb(100_000_000n)).toBe("100 MB");
        expect(formatMb(0n)).toBe("0 MB");
    });

    it("truncates toward zero for sub-MB values", () => {
        expect(formatMb(999_999n)).toBe("0 MB");
    });

    it("handles values well above 2^53", () => {
        const tenTb = 10_000_000_000_000n; // 10 TB in bytes
        expect(formatMb(tenTb)).toBe("10000000 MB");
    });
});
