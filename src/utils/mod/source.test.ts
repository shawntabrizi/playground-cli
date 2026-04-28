import { describe, it, expect } from "vitest";
import { parseGitHubRepoUrl, resolveDefaultBranch } from "./source.js";

describe("parseGitHubRepoUrl", () => {
    it("parses https github URL", () => {
        expect(parseGitHubRepoUrl("https://github.com/foo/bar")).toEqual({ owner: "foo", repo: "bar" });
    });

    it("parses https github URL with .git suffix", () => {
        expect(parseGitHubRepoUrl("https://github.com/foo/bar.git")).toEqual({ owner: "foo", repo: "bar" });
    });

    it("parses ssh github URL", () => {
        expect(parseGitHubRepoUrl("git@github.com:foo/bar.git")).toEqual({ owner: "foo", repo: "bar" });
    });

    it("parses URL with trailing slash", () => {
        expect(parseGitHubRepoUrl("https://github.com/foo/bar/")).toEqual({ owner: "foo", repo: "bar" });
    });

    it("returns null for non-GitHub URLs", () => {
        expect(parseGitHubRepoUrl("https://gitlab.com/foo/bar")).toBeNull();
    });

    it("returns null for malformed input", () => {
        expect(parseGitHubRepoUrl("not a url")).toBeNull();
        expect(parseGitHubRepoUrl("https://github.com/foo")).toBeNull();
        expect(parseGitHubRepoUrl("")).toBeNull();
    });
});

describe("resolveDefaultBranch", () => {
    it("returns the API's default_branch when reachable", async () => {
        const fetchImpl: typeof fetch = async (url) => {
            expect(String(url)).toBe("https://api.github.com/repos/foo/bar");
            return new Response(JSON.stringify({ default_branch: "develop" }), { status: 200 });
        };
        const branch = await resolveDefaultBranch({ owner: "foo", repo: "bar" }, { fetch: fetchImpl });
        expect(branch).toBe("develop");
    });

    it("falls back to main when API GET fails and main exists", async () => {
        const fetchImpl: typeof fetch = async (url) => {
            const u = String(url);
            if (u.startsWith("https://api.github.com")) return new Response("rate limit", { status: 403 });
            if (u === "https://github.com/foo/bar/tree/main") return new Response("ok", { status: 200 });
            return new Response("not found", { status: 404 });
        };
        const branch = await resolveDefaultBranch({ owner: "foo", repo: "bar" }, { fetch: fetchImpl });
        expect(branch).toBe("main");
    });

    it("falls back to master when neither API nor main works", async () => {
        const fetchImpl: typeof fetch = async (url) => {
            const u = String(url);
            if (u.startsWith("https://api.github.com")) return new Response("err", { status: 500 });
            if (u === "https://github.com/foo/bar/tree/main") return new Response("nf", { status: 404 });
            if (u === "https://github.com/foo/bar/tree/master") return new Response("ok", { status: 200 });
            return new Response("nope", { status: 404 });
        };
        const branch = await resolveDefaultBranch({ owner: "foo", repo: "bar" }, { fetch: fetchImpl });
        expect(branch).toBe("master");
    });

    it("throws when nothing resolves", async () => {
        const fetchImpl: typeof fetch = async () => new Response("err", { status: 500 });
        await expect(
            resolveDefaultBranch({ owner: "foo", repo: "bar" }, { fetch: fetchImpl }),
        ).rejects.toThrow(/could not resolve a default branch/i);
    });
});
