import { describe, it, expect } from "vitest";
import { defaultRepoName } from "./repoName.js";

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
