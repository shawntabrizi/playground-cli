import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRepoName, validateRepoName } from "./repoName.js";

describe("defaultRepoName", () => {
    it("slugifies and appends a 6-hex-char suffix", () => {
        const name = defaultRepoName("My Cool App.dot");
        expect(name).toMatch(/^my-cool-app-[0-9a-f]{6}$/);
    });

    it("strips the .dot suffix", () => {
        expect(defaultRepoName("foo.dot")).toMatch(/^foo-[0-9a-f]{6}$/);
    });

    it("handles domains without .dot", () => {
        expect(defaultRepoName("bar")).toMatch(/^bar-[0-9a-f]{6}$/);
    });

    it("produces different suffixes on consecutive calls", () => {
        const a = defaultRepoName("x.dot");
        const b = defaultRepoName("x.dot");
        expect(a).not.toBe(b);
    });
});

describe("validateRepoName", () => {
    // Each test runs inside a fresh temp dir so existsSync checks are
    // deterministic and isolated from the repo working tree.
    let prev: string;
    let tmp: string;
    beforeEach(() => {
        prev = process.cwd();
        tmp = mkdtempSync(join(tmpdir(), "mod-reponame-"));
        process.chdir(tmp);
    });
    afterEach(() => {
        process.chdir(prev);
        rmSync(tmp, { recursive: true, force: true });
    });

    it("accepts a simple name", () => {
        expect(validateRepoName("my-app")).toBeNull();
    });

    it("accepts letters, digits, '.', '-', '_'", () => {
        expect(validateRepoName("A.b-c_1")).toBeNull();
    });

    it("rejects empty", () => {
        expect(validateRepoName("")).toMatch(/required/);
    });

    it("rejects spaces and slashes", () => {
        expect(validateRepoName("a b")).toMatch(/may only contain/);
        expect(validateRepoName("a/b")).toMatch(/may only contain/);
    });

    it("rejects leading '.' or '-'", () => {
        expect(validateRepoName(".hidden")).toMatch(/cannot start/);
        expect(validateRepoName("-dash")).toMatch(/cannot start/);
    });

    it("rejects names that collide with an existing directory", () => {
        mkdirSync("taken");
        expect(validateRepoName("taken")).toMatch(/already exists/);
    });

    it("rejects names over 100 chars", () => {
        expect(validateRepoName("a".repeat(101))).toMatch(/too long/);
    });
});
