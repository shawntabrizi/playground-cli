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
    sourceUnavailableBody,
    SourceUnavailableHalt,
    PICK_ANOTHER_APP,
    BROWSE_OTHER_APPS,
} from "./sourceUnavailable.js";

describe("sourceUnavailableBody", () => {
    it("names the domain and states the source is no longer publicly available", () => {
        const body = sourceUnavailableBody("playground.dot", PICK_ANOTHER_APP);
        expect(body).toContain("playground.dot");
        expect(body).toContain("no longer publicly available");
    });

    it("appends the picker next-step for the interactive path", () => {
        expect(sourceUnavailableBody("x.dot", PICK_ANOTHER_APP)).toContain(PICK_ANOTHER_APP);
    });

    it("appends the browse next-step for the direct path", () => {
        expect(sourceUnavailableBody("x.dot", BROWSE_OTHER_APPS)).toContain("playground mod");
    });

    it("does not speculate about the publisher (we can't distinguish private/deleted/renamed)", () => {
        const body = sourceUnavailableBody("x.dot", PICK_ANOTHER_APP).toLowerCase();
        expect(body).not.toContain("publisher");
        expect(body).not.toContain("private");
    });
});

describe("SourceUnavailableHalt", () => {
    it("is an Error carrying the halt-as-warning flag StepRunner duck-types", () => {
        const err = new SourceUnavailableHalt("nope");
        expect(err).toBeInstanceOf(Error);
        expect((err as unknown as { haltAsWarning: boolean }).haltAsWarning).toBe(true);
    });
});
