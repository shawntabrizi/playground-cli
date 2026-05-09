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
import { filterModdable, type AppEntry } from "./browserFilter.js";

const make = (domain: string, repository: string | null): AppEntry => ({
    domain,
    name: null,
    description: null,
    repository,
    branch: null,
    tag: null,
});

describe("filterModdable", () => {
    it("hides entries without a repository when moddableOnly is true", () => {
        const apps = [make("a.dot", "https://github.com/x/a"), make("b.dot", null)];
        expect(filterModdable(apps, true)).toEqual([apps[0]]);
    });

    it("returns everything when moddableOnly is false", () => {
        const apps = [make("a.dot", "https://github.com/x/a"), make("b.dot", null)];
        expect(filterModdable(apps, false)).toEqual(apps);
    });

    it("treats empty-string repository as non-moddable", () => {
        const apps = [make("a.dot", "")];
        expect(filterModdable(apps, true)).toEqual([]);
    });

    it("preserves order", () => {
        const apps = [
            make("a.dot", "https://github.com/x/a"),
            make("b.dot", null),
            make("c.dot", "https://github.com/x/c"),
        ];
        expect(filterModdable(apps, true)).toEqual([apps[0], apps[2]]);
    });
});
