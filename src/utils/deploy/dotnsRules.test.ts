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
import {
    POP_STATUS,
    countTrailingDigits,
    validateDomainLabel,
    classifyLabel,
} from "./dotnsRules.js";

describe("countTrailingDigits", () => {
    it("counts only the trailing run of digits", () => {
        expect(countTrailingDigits("myapp")).toBe(0);
        expect(countTrailingDigits("myapp42")).toBe(2);
        expect(countTrailingDigits("my4pp")).toBe(0);
        expect(countTrailingDigits("app123")).toBe(3);
    });
});

describe("validateDomainLabel", () => {
    it("accepts a valid lowercase label", () => {
        expect(validateDomainLabel("my-app")).toEqual({ ok: true });
        expect(validateDomainLabel("my-app42")).toEqual({ ok: true });
        expect(validateDomainLabel("a--b")).toEqual({ ok: true }); // consecutive hyphens allowed
    });

    it("rejects uppercase (the contract does not lowercase)", () => {
        const r = validateDomainLabel("MyApp");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/lowercase/i);
    });

    it("rejects labels shorter than 3 chars", () => {
        const r = validateDomainLabel("ab");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/at least 3/i);
    });

    it("rejects labels longer than 63 chars", () => {
        const r = validateDomainLabel("a".repeat(64));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toMatch(/at most 63/i);
    });

    it("rejects leading and trailing hyphens", () => {
        expect(validateDomainLabel("-app").ok).toBe(false);
        expect(validateDomainLabel("app-").ok).toBe(false);
    });

    it("rejects illegal characters", () => {
        expect(validateDomainLabel("my_app").ok).toBe(false);
        expect(validateDomainLabel("my.app").ok).toBe(false);
        expect(validateDomainLabel("my app").ok).toBe(false);
    });

    it("rejects a digit suffix that is not exactly two digits", () => {
        const one = validateDomainLabel("myapp1");
        expect(one.ok).toBe(false);
        if (!one.ok) expect(one.reason).toMatch(/two digits/i);
        expect(validateDomainLabel("myapp123").ok).toBe(false);
        expect(validateDomainLabel("myapp12").ok).toBe(true); // exactly two is fine
    });

    it("accepts the exact min and max lengths", () => {
        expect(validateDomainLabel("abc")).toEqual({ ok: true }); // exactly 3
        expect(validateDomainLabel("a".repeat(63))).toEqual({ ok: true }); // exactly 63
    });

    it("rejects a digit suffix preceded by a dash but accepts one that is not", () => {
        const dashed = validateDomainLabel("my-app-42");
        expect(dashed.ok).toBe(false);
        if (!dashed.ok) expect(dashed.reason).toMatch(/dash/i);
        expect(validateDomainLabel("my-app42")).toEqual({ ok: true });
    });
});

describe("classifyLabel", () => {
    it("base length >= 9 is NoStatus regardless of a 0- or 2-digit suffix", () => {
        // Regression: the old mirror returned Full for base>=9 with no digits.
        expect(classifyLabel("my-cool-app").status).toBe(POP_STATUS.NoStatus); // base 11, td 0
        expect(classifyLabel("my-app-test12").status).toBe(POP_STATUS.NoStatus); // base 11, td 2
    });

    it("base length 6-8 with no digit suffix requires Full", () => {
        expect(classifyLabel("myapptst").status).toBe(POP_STATUS.Full); // base 8, td 0
    });

    it("base length 6-8 with a 2-digit suffix requires Lite", () => {
        expect(classifyLabel("myappz12").status).toBe(POP_STATUS.Lite); // base 6, td 2
    });

    it("base length <= 5 is Reserved (governance)", () => {
        const r = classifyLabel("abcde"); // base 5
        expect(r.status).toBe(POP_STATUS.Reserved);
        expect(r.message).toMatch(/governance/i);
    });

    it("a short base with a valid 2-digit suffix passes validation but classifies Reserved", () => {
        // The validate/classify split: "ab12" is syntactically valid (length 4,
        // exactly 2 trailing digits, no dash before them) yet its base is 2 chars
        // → governance-Reserved. Front-line validators accept it; the availability
        // classifier is what blocks it.
        expect(validateDomainLabel("ab12")).toEqual({ ok: true });
        expect(classifyLabel("ab12").status).toBe(POP_STATUS.Reserved); // base 2
    });

    it("an invalid digit suffix (1 or >2) is Reserved", () => {
        // Regression: the old mirror silently allowed a 1-digit suffix.
        expect(classifyLabel("myapp1").status).toBe(POP_STATUS.Reserved);
        expect(classifyLabel("polkadot12345").status).toBe(POP_STATUS.Reserved);
    });

    it("pins the base-length boundaries at 6 and 9", () => {
        expect(classifyLabel("abcdef").status).toBe(POP_STATUS.Full); // base 6, td 0 → Full (lower edge)
        expect(classifyLabel("abcdefghi").status).toBe(POP_STATUS.NoStatus); // base 9, td 0 → NoStatus
    });
});
