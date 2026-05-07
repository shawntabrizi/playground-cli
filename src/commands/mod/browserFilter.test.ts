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
