import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    decideRepositoryAction,
    resolveRepositoryUrl,
    assertPublicGitHubRepo,
    ModablePreflightError,
} from "./modable.js";

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

describe("assertPublicGitHubRepo", () => {
    // After the rate-limit-elimination work this function probes the regular
    // `github.com/{owner}/{repo}` HTML page (200/404 status, no body) instead
    // of `api.github.com`, so the mocks here only inspect status codes.
    it("does nothing on a 2xx response (repo is public)", async () => {
        let calledUrl = "";
        const mockFetch: typeof fetch = async (url) => {
            calledUrl = String(url);
            return new Response(null, { status: 200 });
        };
        await expect(
            assertPublicGitHubRepo("https://github.com/foo/bar", mockFetch),
        ).resolves.toBeUndefined();
        expect(calledUrl).toBe("https://github.com/foo/bar");
    });

    it("throws on 404 (private or missing — GitHub returns the same status for both)", async () => {
        const mockFetch: typeof fetch = async () => new Response("Not Found", { status: 404 });
        await expect(
            assertPublicGitHubRepo("https://github.com/org/ghost", mockFetch),
        ).rejects.toThrow(/private or does not exist/i);
    });

    it("does nothing for a non-GitHub URL", async () => {
        const mockFetch: typeof fetch = async () => {
            throw new Error("should not be called");
        };
        await expect(
            assertPublicGitHubRepo("https://gitlab.com/foo/bar", mockFetch),
        ).resolves.toBeUndefined();
    });

    it("does nothing on network error (fail open — codeload reveals truth later)", async () => {
        const mockFetch: typeof fetch = async () => {
            throw new Error("ECONNREFUSED");
        };
        await expect(
            assertPublicGitHubRepo("https://github.com/foo/bar", mockFetch),
        ).resolves.toBeUndefined();
    });

    it("does not throw on 5xx (transient server error)", async () => {
        const mockFetch: typeof fetch = async () => new Response("oops", { status: 502 });
        await expect(
            assertPublicGitHubRepo("https://github.com/foo/bar", mockFetch),
        ).resolves.toBeUndefined();
    });

    it("does not throw on 403 (anti-abuse throttling — let downstream surface the truth)", async () => {
        const mockFetch: typeof fetch = async () => new Response("forbidden", { status: 403 });
        await expect(
            assertPublicGitHubRepo("https://github.com/foo/bar", mockFetch),
        ).resolves.toBeUndefined();
    });
});

describe("resolveRepositoryUrl", () => {
    let tmp: string | null = null;

    afterEach(() => {
        if (tmp) rmSync(tmp, { recursive: true, force: true });
        tmp = null;
    });

    const publicFetch: typeof fetch = async () => new Response(null, { status: 200 });
    const privateFetch: typeof fetch = async () => new Response("Not Found", { status: 404 });

    it("uses an existing origin without pushing", async () => {
        tmp = mkdtempSync(join(tmpdir(), "pg-modable-origin-"));
        execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
        execFileSync("git", ["remote", "add", "origin", "git@github.com:foo/bar.git"], {
            cwd: tmp,
            stdio: "ignore",
        });

        await expect(
            resolveRepositoryUrl({ cwd: tmp, repoName: null, fetch: publicFetch }),
        ).resolves.toBe("git@github.com:foo/bar");
    });

    it("throws when the existing origin is a private GitHub repo", async () => {
        tmp = mkdtempSync(join(tmpdir(), "pg-modable-private-"));
        execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
        execFileSync("git", ["remote", "add", "origin", "https://github.com/org/secret.git"], {
            cwd: tmp,
            stdio: "ignore",
        });

        await expect(
            resolveRepositoryUrl({ cwd: tmp, repoName: null, fetch: privateFetch }),
        ).rejects.toThrow(ModablePreflightError);
    });
});
