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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    countFiles,
    findIndexHtmlRoot,
    InvalidSiteUrlError,
    mirrorSite,
    validateUrl,
    WgetMissingError,
} from "./mirror.js";

describe("validateUrl", () => {
    it("accepts https URLs verbatim", () => {
        expect(validateUrl("https://example.com")).toBe("https://example.com/");
    });

    it("accepts http URLs verbatim", () => {
        expect(validateUrl("http://example.com")).toBe("http://example.com/");
    });

    it("prepends https:// to bare hostnames", () => {
        expect(validateUrl("example.com")).toBe("https://example.com/");
    });

    it("preserves path segments under a bare hostname", () => {
        expect(validateUrl("you.github.io/site")).toBe("https://you.github.io/site");
    });

    it("rejects ftp:// with a precise reason", () => {
        expect(() => validateUrl("ftp://example.com")).toThrow(InvalidSiteUrlError);
        expect(() => validateUrl("ftp://example.com")).toThrow(/unsupported scheme ftp:/);
    });

    it("rejects file:// (defends against `--site=file:///etc/passwd`)", () => {
        expect(() => validateUrl("file:///etc/passwd")).toThrow(InvalidSiteUrlError);
    });

    it("rejects unparseable input", () => {
        expect(() => validateUrl("::: not a url :::")).toThrow(InvalidSiteUrlError);
        expect(() => validateUrl("::: not a url :::")).toThrow(/not a parseable URL/);
    });
});

describe("countFiles", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "mirror-countfiles-test-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("returns 0 for an empty directory", () => {
        expect(countFiles(dir)).toBe(0);
    });

    it("counts files at the root", () => {
        writeFileSync(join(dir, "a.txt"), "a");
        writeFileSync(join(dir, "b.txt"), "b");
        expect(countFiles(dir)).toBe(2);
    });

    it("walks subdirectories", () => {
        writeFileSync(join(dir, "root.html"), "<html/>");
        mkdirSync(join(dir, "assets"));
        writeFileSync(join(dir, "assets", "style.css"), "body{}");
        mkdirSync(join(dir, "assets", "img"));
        writeFileSync(join(dir, "assets", "img", "logo.svg"), "<svg/>");
        expect(countFiles(dir)).toBe(3);
    });

    it("does not count directories", () => {
        mkdirSync(join(dir, "empty"));
        mkdirSync(join(dir, "another"));
        expect(countFiles(dir)).toBe(0);
    });

    it("returns 0 when the path does not exist (defensive)", () => {
        expect(countFiles(join(dir, "this-does-not-exist"))).toBe(0);
    });
});

describe("findIndexHtmlRoot", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "mirror-findroot-test-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("returns the root when index.html sits at the top level", () => {
        // The shawntabrizi.com case: `https://host/` mirror, no path segments.
        writeFileSync(join(dir, "index.html"), "<html/>");
        writeFileSync(join(dir, "style.css"), "body{}");
        expect(findIndexHtmlRoot(dir)).toBe(dir);
    });

    it("resolves down through one path segment (the user's reported case)", () => {
        // Reproduces `https://you.github.io/visualise-agents/` →
        // wget writes to `<tmp>/visualise-agents/index.html`.
        mkdirSync(join(dir, "visualise-agents"));
        writeFileSync(join(dir, "visualise-agents", "index.html"), "<html/>");
        writeFileSync(join(dir, "visualise-agents", "page.html"), "<html/>");
        expect(findIndexHtmlRoot(dir)).toBe(join(dir, "visualise-agents"));
    });

    it("resolves down through deeper paths", () => {
        // Multi-segment URL paths like `https://host/team/project/`.
        mkdirSync(join(dir, "team"));
        mkdirSync(join(dir, "team", "project"));
        writeFileSync(join(dir, "team", "project", "index.html"), "<html/>");
        expect(findIndexHtmlRoot(dir)).toBe(join(dir, "team", "project"));
    });

    it("picks the shallowest index.html when several exist (BFS)", () => {
        // `<tmp>/index.html` AND `<tmp>/sub/index.html` — return the outer one
        // so the user's chosen page wins over any sub-page index.
        writeFileSync(join(dir, "index.html"), "<html>outer</html>");
        mkdirSync(join(dir, "sub"));
        writeFileSync(join(dir, "sub", "index.html"), "<html>inner</html>");
        expect(findIndexHtmlRoot(dir)).toBe(dir);
    });

    it("returns null when no index.html exists anywhere", () => {
        // Edge case: a fully-client-rendered SPA mirror with only asset files.
        writeFileSync(join(dir, "style.css"), "body{}");
        mkdirSync(join(dir, "assets"));
        writeFileSync(join(dir, "assets", "logo.svg"), "<svg/>");
        expect(findIndexHtmlRoot(dir)).toBeNull();
    });
});

describe("mirrorSite (spawn-injected)", () => {
    it("maps spawn ENOENT to WgetMissingError so users get a clear install hint", async () => {
        // Point at a path that cannot exist on any sane system. Node's
        // child_process emits `error` with `code: "ENOENT"` synchronously,
        // which mirror.ts maps to WgetMissingError.
        await expect(
            mirrorSite({
                url: "https://example.com",
                wgetBinary: "/this/binary/definitely/does/not/exist-12345",
            }),
        ).rejects.toThrow(WgetMissingError);
    });

    it("rejects the empty-mirror case (wget exits 0 but writes no files)", async () => {
        // `/usr/bin/true` exits 0 immediately and writes nothing. mirror.ts
        // then sees fileCount === 0 from the temp dir and surfaces the
        // "no files were downloaded" error.
        await expect(
            mirrorSite({
                url: "https://example.com",
                wgetBinary: "/usr/bin/true",
            }),
        ).rejects.toThrow(/no files were downloaded/);
    });
});
