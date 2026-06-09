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
    BUILD_HELP,
    CONTRACTS_HELP,
    SIGNER_HELP,
    PUBLISH_HELP,
    MODDABLE_HELP,
    TAGS_HELP,
    DOMAIN_HELP,
    BUILD_DIR_HINT,
    DOMAIN_HINT,
    type PromptBox,
} from "./promptHelp.js";

const BOXES: Record<string, PromptBox> = {
    BUILD_HELP,
    CONTRACTS_HELP,
    SIGNER_HELP,
    PUBLISH_HELP,
    MODDABLE_HELP,
    TAGS_HELP,
    DOMAIN_HELP,
};

describe("deploy prompt help boxes", () => {
    it("every box has a non-empty title and body", () => {
        for (const [name, box] of Object.entries(BOXES)) {
            expect(box.title.trim(), `${name}.title`).not.toBe("");
            expect(box.body.trim(), `${name}.body`).not.toBe("");
        }
    });

    // Soft cap so the boxes stay glanceable rather than turning into a wall of
    // text. ~320 chars wraps to roughly four lines at the picker's width.
    it("keeps every body readable (<= 320 chars)", () => {
        for (const [name, box] of Object.entries(BOXES)) {
            expect(box.body.length, `${name}.body length`).toBeLessThanOrEqual(320);
        }
    });
});

describe("plain-language anchors (the prompts the feedback called out)", () => {
    it("contracts help explains the website-vs-contract distinction without bare jargon", () => {
        const body = CONTRACTS_HELP.body.toLowerCase();
        expect(body).toContain("website");
        expect(body).toContain("contract");
        // It must tell the user what to pick for each case (not just contain
        // the bare words "no"/"yes", which would match "another"/"yesterday").
        expect(body).toContain("choose no");
        expect(body).toContain("choose yes");
    });

    it("moddable help explains what modding is and what gets shared", () => {
        const body = MODDABLE_HELP.body.toLowerCase();
        expect(body).toContain("playground mod");
        expect(body).toContain("github");
    });

    it("domain help steers users to a no-personhood name (9+ char base)", () => {
        const body = DOMAIN_HELP.body.toLowerCase();
        // The actionable threshold for an open-to-all (NoStatus) name.
        expect(body).toContain("9");
        expect(body).toContain("personhood");
        // Per product wording: say "personhood check", never "identity check".
        expect(body).not.toContain("identity");
    });
});

describe("trivial-input hints", () => {
    it("are one-line, non-empty strings", () => {
        for (const [name, hint] of Object.entries({ BUILD_DIR_HINT, DOMAIN_HINT })) {
            expect(hint.trim(), name).not.toBe("");
            expect(hint, name).not.toContain("\n");
        }
    });
});
