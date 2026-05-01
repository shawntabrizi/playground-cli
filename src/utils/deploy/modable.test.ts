import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideRepositoryAction, resolveRepositoryUrl } from "./modable.js";

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

describe("resolveRepositoryUrl", () => {
    let tmp: string | null = null;

    afterEach(() => {
        if (tmp) rmSync(tmp, { recursive: true, force: true });
        tmp = null;
    });

    it("uses an existing origin without pushing", async () => {
        tmp = mkdtempSync(join(tmpdir(), "pg-modable-origin-"));
        execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
        execFileSync("git", ["remote", "add", "origin", "git@github.com:foo/bar.git"], {
            cwd: tmp,
            stdio: "ignore",
        });

        await expect(resolveRepositoryUrl({ cwd: tmp, repoName: null })).resolves.toBe(
            "git@github.com:foo/bar",
        );
    });
});
