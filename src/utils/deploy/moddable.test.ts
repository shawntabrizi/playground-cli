import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    resolveRepositoryUrl,
    assertPublicGitHubRepo,
    ModdablePreflightError,
} from "./moddable.js";

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

    it("throws on a non-GitHub URL — dot mod only fetches from codeload.github.com", async () => {
        const mockFetch: typeof fetch = async () => {
            throw new Error("should not be called");
        };
        await expect(
            assertPublicGitHubRepo("https://gitlab.com/foo/bar", mockFetch),
        ).rejects.toThrow(/must use a public github repository/i);
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

    it("returns the existing origin when it points to a public GitHub repo", async () => {
        tmp = mkdtempSync(join(tmpdir(), "pg-moddable-origin-"));
        execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
        execFileSync("git", ["remote", "add", "origin", "git@github.com:foo/bar.git"], {
            cwd: tmp,
            stdio: "ignore",
        });

        await expect(resolveRepositoryUrl({ cwd: tmp, fetch: publicFetch })).resolves.toBe(
            "git@github.com:foo/bar",
        );
    });

    it("throws when the existing origin is a private GitHub repo", async () => {
        tmp = mkdtempSync(join(tmpdir(), "pg-moddable-private-"));
        execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
        execFileSync("git", ["remote", "add", "origin", "https://github.com/org/secret.git"], {
            cwd: tmp,
            stdio: "ignore",
        });

        await expect(resolveRepositoryUrl({ cwd: tmp, fetch: privateFetch })).rejects.toThrow(
            ModdablePreflightError,
        );
    });

    it("throws when the existing origin is non-GitHub", async () => {
        tmp = mkdtempSync(join(tmpdir(), "pg-moddable-gitlab-"));
        execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
        execFileSync("git", ["remote", "add", "origin", "https://gitlab.com/foo/bar"], {
            cwd: tmp,
            stdio: "ignore",
        });

        await expect(resolveRepositoryUrl({ cwd: tmp, fetch: publicFetch })).rejects.toThrow(
            /must use a public github repository/i,
        );
    });

    it("throws with an actionable message when no origin is set", async () => {
        tmp = mkdtempSync(join(tmpdir(), "pg-moddable-no-origin-"));
        execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });

        await expect(resolveRepositoryUrl({ cwd: tmp, fetch: publicFetch })).rejects.toThrow(
            /no github origin configured/i,
        );
    });
});
