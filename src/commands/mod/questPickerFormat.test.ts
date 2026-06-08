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
import { pad, formatDifficulty } from "./questPickerFormat.js";

describe("pad", () => {
    it("right-pads a short string to the requested width", () => {
        expect(pad("ab", 5)).toBe("ab   ");
        expect(pad("ab", 5)).toHaveLength(5);
    });

    it("leaves an exact-width string untouched", () => {
        expect(pad("abcde", 5)).toBe("abcde");
    });

    it("truncates an overflowing string with an ellipsis at the target width", () => {
        expect(pad("abcdef", 5)).toBe("abcd…");
        expect(pad("abcdef", 5)).toHaveLength(5);
    });
});

describe("formatDifficulty", () => {
    it("renders one star per level", () => {
        expect(formatDifficulty(1)).toBe("★");
        expect(formatDifficulty(3)).toBe("★★★");
    });

    it("caps at 5 stars", () => {
        expect(formatDifficulty(9)).toBe("★★★★★");
    });

    it("shows an em-less dash for unset or non-positive values", () => {
        expect(formatDifficulty(undefined)).toBe("—");
        expect(formatDifficulty(0)).toBe("—");
        expect(formatDifficulty(-2)).toBe("—");
    });
});
