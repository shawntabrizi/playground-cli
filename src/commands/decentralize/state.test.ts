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
import { pickNextStage, validateDomainInput, validateSiteUrlInput } from "./state.js";

describe("pickNextStage", () => {
    it("starts at prompt-url when nothing has been filled", () => {
        expect(
            pickNextStage({
                siteUrl: null,
                signerMode: null,
                domainLabel: null,
                domainRaw: null,
                publishToPlayground: null,
            }),
        ).toEqual({ kind: "prompt-url" });
    });

    it("advances to prompt-signer once the URL is known", () => {
        expect(
            pickNextStage({
                siteUrl: "https://example.com",
                signerMode: null,
                domainLabel: null,
                domainRaw: null,
                publishToPlayground: null,
            }),
        ).toEqual({ kind: "prompt-signer" });
    });

    it("advances to prompt-domain once URL + signer are picked", () => {
        expect(
            pickNextStage({
                siteUrl: "https://example.com",
                signerMode: "dev",
                domainLabel: null,
                domainRaw: null,
                publishToPlayground: null,
            }),
        ).toEqual({ kind: "prompt-domain" });
    });

    it("advances to validate-domain once domain has been typed but not yet validated", () => {
        expect(
            pickNextStage({
                siteUrl: "https://example.com",
                signerMode: "phone",
                domainLabel: null,
                domainRaw: "myapp",
                publishToPlayground: null,
            }),
        ).toEqual({ kind: "validate-domain", raw: "myapp" });
    });

    it("asks the publish question once the domain is validated", () => {
        expect(
            pickNextStage({
                siteUrl: "https://example.com",
                signerMode: "dev",
                domainLabel: "myapp",
                domainRaw: "myapp",
                publishToPlayground: null,
            }),
        ).toEqual({ kind: "prompt-publish" });
    });

    it("lands on confirm once the publish answer is locked in", () => {
        expect(
            pickNextStage({
                siteUrl: "https://example.com",
                signerMode: "dev",
                domainLabel: "myapp",
                domainRaw: "myapp",
                publishToPlayground: false,
            }),
        ).toEqual({ kind: "confirm" });
    });

    it("also lands on confirm when publish was pre-answered via --playground", () => {
        expect(
            pickNextStage({
                siteUrl: "https://example.com",
                signerMode: "dev",
                domainLabel: "myapp",
                domainRaw: "myapp",
                publishToPlayground: true,
            }),
        ).toEqual({ kind: "confirm" });
    });

    it("treats an empty-string domainRaw as 'asked-already, use auto'", () => {
        // Mirrors the user submitting a blank domain prompt to opt into auto-naming.
        expect(
            pickNextStage({
                siteUrl: "https://example.com",
                signerMode: "dev",
                domainLabel: null,
                domainRaw: "",
                publishToPlayground: null,
            }),
        ).toEqual({ kind: "validate-domain", raw: "" });
    });
});

describe("validateSiteUrlInput", () => {
    it("accepts https URLs", () => {
        expect(validateSiteUrlInput("https://example.com")).toBeNull();
    });

    it("accepts http URLs", () => {
        expect(validateSiteUrlInput("http://example.com")).toBeNull();
    });

    it("accepts bare hostnames (mirror.ts will prepend https)", () => {
        expect(validateSiteUrlInput("example.com")).toBeNull();
        expect(validateSiteUrlInput("you.github.io/site")).toBeNull();
    });

    it("rejects non-http schemes with a precise message", () => {
        expect(validateSiteUrlInput("ftp://example.com")).toBe("only http(s) URLs are supported");
        expect(validateSiteUrlInput("file:///etc/passwd")).toBe("only http(s) URLs are supported");
    });

    it("rejects empty input", () => {
        expect(validateSiteUrlInput("")).toBe("enter a URL");
        expect(validateSiteUrlInput("   ")).toBe("enter a URL");
    });

    it("rejects obvious junk", () => {
        expect(validateSiteUrlInput("not a url at all!!")).toBe("doesn't look like a URL");
    });
});

describe("validateDomainInput", () => {
    it("accepts a bare label", () => {
        expect(validateDomainInput("myapp")).toBeNull();
    });

    it("accepts the .dot suffix", () => {
        expect(validateDomainInput("myapp.dot")).toBeNull();
    });

    it("accepts digits and a valid 2-digit suffix", () => {
        expect(validateDomainInput("my-app42")).toBeNull();
    });

    it("treats empty as 'auto-generate'", () => {
        expect(validateDomainInput("")).toBeNull();
        expect(validateDomainInput("   ")).toBeNull();
    });

    it("rejects leading dashes and underscores", () => {
        // Canonical rules: no leading/trailing dash, lowercase-only charset.
        expect(validateDomainInput("-leading")).toMatch(/dash/i);
        expect(validateDomainInput("under_score")).toMatch(/lowercase/i);
    });

    it("rejects uppercase (the chain stores lowercase only)", () => {
        // Regression: the old inline validator was case-insensitive and let
        // MixedCase through to fail one screen later at normalizeDomain. The
        // canonical rules reject it inline.
        expect(validateDomainInput("MyApp")).toMatch(/lowercase/i);
    });

    it("rejects a dash before the digit suffix (strips to a trailing-hyphen base)", () => {
        expect(validateDomainInput("my-app-42")).toMatch(/dash/i);
    });
});
