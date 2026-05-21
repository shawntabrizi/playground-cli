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
 * Tests for git.ts — focused on sanitize() since it handles tricky
 * ANSI/cursor output from child processes (pnpm, Ink programs),
 * and runCommand's log-file tee behaviour.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCommand } from "./git.js";

// sanitize is not exported, so we test it indirectly by importing the module
// and calling a function that uses it. Instead, let's extract the regex and
// test the logic directly.

// Re-implement the same logic for testing — if the regex in git.ts changes,
// this test must be updated to match (or we export sanitize).
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI stripping
const ANSI_RE = /\x1B(?:\[[0-9;]*[A-Za-z]|\].*?\x07|[^[])/g;
function sanitize(s: string): string {
    return s.replace(ANSI_RE, "").replace(/\r/g, "");
}

describe("sanitize", () => {
    it("passes through clean text unchanged", () => {
        expect(sanitize("hello world")).toBe("hello world");
    });

    it("strips basic color codes", () => {
        expect(sanitize("\x1B[32mgreen\x1B[0m")).toBe("green");
    });

    it("strips bold/dim/reset sequences", () => {
        expect(sanitize("\x1B[1mbold\x1B[22m normal\x1B[0m")).toBe("bold normal");
    });

    it("strips cursor movement (Ink uses these)", () => {
        // [2K = clear line, [1A = move up, [G = move to column 0
        expect(sanitize("\x1B[2K\x1B[1A\x1B[G")).toBe("");
    });

    it("strips pnpm box-drawing output with embedded ANSI", () => {
        const pnpmLine =
            "\x1B[33m╭ Warning ──────╮\x1B[0m\r\n\x1B[33m│\x1B[0m text \x1B[33m│\x1B[0m";
        const result = sanitize(pnpmLine);
        expect(result).not.toContain("\x1B");
        expect(result).not.toContain("\r");
        expect(result).toContain("Warning");
        expect(result).toContain("text");
    });

    it("strips OSC sequences (terminal title, etc.)", () => {
        expect(sanitize("\x1B]0;my title\x07rest")).toBe("rest");
    });

    it("removes carriage returns", () => {
        expect(sanitize("progress\r50%\r100%\ndone")).toBe("progress50%100%\ndone");
    });

    it("handles empty string", () => {
        expect(sanitize("")).toBe("");
    });

    it("handles string with only ANSI codes", () => {
        expect(sanitize("\x1B[2K\x1B[1A\x1B[0m\r")).toBe("");
    });

    it("preserves unicode text (box-drawing chars, emojis)", () => {
        expect(sanitize("✔ done │ 100%")).toBe("✔ done │ 100%");
    });

    it("strips compound SGR parameters", () => {
        // [38;5;196m = 256-color red
        expect(sanitize("\x1B[38;5;196mred\x1B[0m")).toBe("red");
    });
});

describe("runCommand log-file tee", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "dot-runcmd-"));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("writes stdout to logFile when provided", async () => {
        const logFile = join(dir, "out.log");
        await runCommand("printf 'hello\\nworld\\n'", { cwd: dir, logFile });
        expect(readFileSync(logFile, "utf-8")).toBe("hello\nworld\n");
    });

    it("captures both stdout and stderr in order", async () => {
        const logFile = join(dir, "out.log");
        // Print one line to stdout, one to stderr. Order between streams isn't
        // strictly guaranteed by the kernel, so we just assert both lines land.
        await runCommand("printf 'on-out\\n'; printf 'on-err\\n' >&2", {
            cwd: dir,
            logFile,
        });
        const contents = readFileSync(logFile, "utf-8");
        expect(contents).toContain("on-out");
        expect(contents).toContain("on-err");
    });

    it("logFile is opt-in — no file is created when omitted", async () => {
        await runCommand("printf 'silent\\n'", { cwd: dir });
        // Directory should still be empty.
        expect(() => readFileSync(join(dir, "out.log"), "utf-8")).toThrow();
    });

    it("captures output even when the command fails", async () => {
        const logFile = join(dir, "out.log");
        await expect(
            runCommand("printf 'before-fail\\n'; exit 7", { cwd: dir, logFile }),
        ).rejects.toThrow();
        expect(readFileSync(logFile, "utf-8")).toContain("before-fail");
    });

    it("still calls the log callback when logFile is provided", async () => {
        const logFile = join(dir, "out.log");
        const lines: string[] = [];
        await runCommand("printf 'a\\nb\\n'", {
            cwd: dir,
            logFile,
            log: (l) => lines.push(l),
        });
        expect(lines).toEqual(["a", "b"]);
        expect(readFileSync(logFile, "utf-8")).toBe("a\nb\n");
    });
});
