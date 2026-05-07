import { describe, it, expect } from "vitest";
import {
    formatBanner,
    isOutdated,
    normalizeVersion,
    shouldSkip,
    startVersionCheck,
} from "./version-check.js";

describe("normalizeVersion", () => {
    it("strips a leading v", () => {
        expect(normalizeVersion("v0.16.14")).toBe("0.16.14");
    });

    it("leaves bare versions alone", () => {
        expect(normalizeVersion("0.16.14")).toBe("0.16.14");
    });
});

describe("isOutdated", () => {
    it("is false when versions are equal", () => {
        expect(isOutdated("0.16.14", "0.16.14")).toBe(false);
        expect(isOutdated("v0.16.14", "v0.16.14")).toBe(false);
    });

    it("is true when patch is behind", () => {
        expect(isOutdated("0.16.14", "0.16.15")).toBe(true);
    });

    it("is true when minor is behind", () => {
        expect(isOutdated("0.16.14", "0.17.0")).toBe(true);
    });

    it("is true when major is behind", () => {
        expect(isOutdated("0.16.14", "1.0.0")).toBe(true);
    });

    it("is false when current is ahead", () => {
        expect(isOutdated("0.17.0", "0.16.14")).toBe(false);
    });

    it("handles mixed v prefixes", () => {
        expect(isOutdated("v0.16.14", "0.16.15")).toBe(true);
    });

    it("returns false for unparseable versions instead of throwing", () => {
        expect(isOutdated("dev/branch-name", "0.16.15")).toBe(false);
        expect(isOutdated("0.16.14", "")).toBe(false);
    });
});

describe("shouldSkip", () => {
    const baseEnv = {} as NodeJS.ProcessEnv;

    it("skips when stdout is not a TTY", () => {
        expect(shouldSkip(["init"], baseEnv, false)).toBe(true);
    });

    it("skips when DOT_NO_UPDATE_CHECK=1", () => {
        expect(shouldSkip(["init"], { DOT_NO_UPDATE_CHECK: "1" }, true)).toBe(true);
    });

    it("does NOT skip when DOT_NO_UPDATE_CHECK is set to anything other than 1", () => {
        expect(shouldSkip(["init"], { DOT_NO_UPDATE_CHECK: "0" }, true)).toBe(false);
    });

    it("skips for `dot update` (which does its own check)", () => {
        expect(shouldSkip(["update"], baseEnv, true)).toBe(true);
    });

    it("skips for `dot help` and `dot help <cmd>` (commander's implicit help)", () => {
        expect(shouldSkip(["help"], baseEnv, true)).toBe(true);
        expect(shouldSkip(["help", "deploy"], baseEnv, true)).toBe(true);
    });

    it("skips for bare `dot` (no args — commander prints usage)", () => {
        expect(shouldSkip([], baseEnv, true)).toBe(true);
    });

    it("skips when CI=true / CI=1", () => {
        expect(shouldSkip(["init"], { CI: "true" }, true)).toBe(true);
        expect(shouldSkip(["init"], { CI: "1" }, true)).toBe(true);
    });

    it("skips for --version / -V", () => {
        expect(shouldSkip(["--version"], baseEnv, true)).toBe(true);
        expect(shouldSkip(["-V"], baseEnv, true)).toBe(true);
    });

    it("skips for --help / -h", () => {
        expect(shouldSkip(["--help"], baseEnv, true)).toBe(true);
        expect(shouldSkip(["init", "-h"], baseEnv, true)).toBe(true);
    });

    it("does not skip on a normal command", () => {
        expect(shouldSkip(["init"], baseEnv, true)).toBe(false);
        expect(shouldSkip(["deploy", "--moddable"], baseEnv, true)).toBe(false);
    });
});

describe("formatBanner", () => {
    it("includes both versions with v-prefixes and the dot update hint", () => {
        const out = formatBanner("0.16.14", "0.16.15");
        expect(out).toContain("v0.16.14");
        expect(out).toContain("v0.16.15");
        expect(out).toContain("dot update");
    });
});

describe("startVersionCheck", () => {
    it("returns a null banner when skip conditions apply (does not call fetch)", async () => {
        let called = false;
        const mockFetch: typeof fetch = async () => {
            called = true;
            return new Response("{}", { status: 200 });
        };
        const handle = startVersionCheck("0.16.14", {
            fetch: mockFetch,
            argv: ["update"],
            env: {} as NodeJS.ProcessEnv,
            isTTY: true,
        });
        expect(await handle.render()).toBeNull();
        expect(called).toBe(false);
    });

    it("returns null when the CLI is on the latest version", async () => {
        const mockFetch: typeof fetch = async () =>
            new Response(JSON.stringify({ version: "0.16.14" }), { status: 200 });
        const handle = startVersionCheck("0.16.14", {
            fetch: mockFetch,
            argv: ["init"],
            env: {} as NodeJS.ProcessEnv,
            isTTY: true,
        });
        expect(await handle.render()).toBeNull();
    });

    it("returns a banner when the CLI is behind", async () => {
        const mockFetch: typeof fetch = async () =>
            new Response(JSON.stringify({ version: "0.17.0" }), { status: 200 });
        const handle = startVersionCheck("0.16.14", {
            fetch: mockFetch,
            argv: ["init"],
            env: {} as NodeJS.ProcessEnv,
            isTTY: true,
        });
        const banner = await handle.render();
        expect(banner).not.toBeNull();
        expect(banner).toContain("v0.16.14");
        expect(banner).toContain("v0.17.0");
        expect(banner).toContain("dot update");
    });

    it("returns null when the network call fails", async () => {
        const mockFetch: typeof fetch = async () => {
            throw new Error("ECONNREFUSED");
        };
        const handle = startVersionCheck("0.16.14", {
            fetch: mockFetch,
            argv: ["init"],
            env: {} as NodeJS.ProcessEnv,
            isTTY: true,
        });
        expect(await handle.render()).toBeNull();
    });

    it("returns null on a non-OK HTTP response", async () => {
        const mockFetch: typeof fetch = async () => new Response("rate limited", { status: 429 });
        const handle = startVersionCheck("0.16.14", {
            fetch: mockFetch,
            argv: ["init"],
            env: {} as NodeJS.ProcessEnv,
            isTTY: true,
        });
        expect(await handle.render()).toBeNull();
    });

    it("returns null when the response body is missing the version field", async () => {
        const mockFetch: typeof fetch = async () =>
            new Response(JSON.stringify({ name: "playground-cli" }), { status: 200 });
        const handle = startVersionCheck("0.16.14", {
            fetch: mockFetch,
            argv: ["init"],
            env: {} as NodeJS.ProcessEnv,
            isTTY: true,
        });
        expect(await handle.render()).toBeNull();
    });
});
