import { describe, it, expect } from "vitest";
import { filterModable, type AppEntry } from "./browserFilter.js";

const make = (domain: string, repository: string | null): AppEntry => ({
    domain,
    name: null,
    description: null,
    repository,
    branch: null,
    tag: null,
});

describe("filterModable", () => {
    it("hides entries without a repository when modableOnly is true", () => {
        const apps = [make("a.dot", "https://github.com/x/a"), make("b.dot", null)];
        expect(filterModable(apps, true)).toEqual([apps[0]]);
    });

    it("returns everything when modableOnly is false", () => {
        const apps = [make("a.dot", "https://github.com/x/a"), make("b.dot", null)];
        expect(filterModable(apps, false)).toEqual(apps);
    });

    it("treats empty-string repository as non-modable", () => {
        const apps = [make("a.dot", "")];
        expect(filterModable(apps, true)).toEqual([]);
    });

    it("preserves order", () => {
        const apps = [
            make("a.dot", "https://github.com/x/a"),
            make("b.dot", null),
            make("c.dot", "https://github.com/x/c"),
        ];
        expect(filterModable(apps, true)).toEqual([apps[0], apps[2]]);
    });
});
