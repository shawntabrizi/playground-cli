import { describe, it, expect } from "vitest";
import { decideRepositoryAction } from "./modable.js";

describe("decideRepositoryAction", () => {
    it("uses the existing origin when present", () => {
        expect(
            decideRepositoryAction({ originUrl: "https://github.com/foo/bar", repoName: null }),
        ).toEqual({ kind: "use-origin", url: "https://github.com/foo/bar" });
    });

    it("creates a new repo when origin is absent and a repo name is provided", () => {
        expect(decideRepositoryAction({ originUrl: null, repoName: "my-app" })).toEqual({
            kind: "create",
            repoName: "my-app",
        });
    });

    it("rejects when origin is absent and no repo name was supplied", () => {
        expect(decideRepositoryAction({ originUrl: null, repoName: null })).toEqual({
            kind: "needs-repo-name",
        });
    });

    it("normalises trailing .git off existing origins", () => {
        expect(
            decideRepositoryAction({
                originUrl: "https://github.com/foo/bar.git",
                repoName: null,
            }),
        ).toEqual({ kind: "use-origin", url: "https://github.com/foo/bar" });
    });
});
