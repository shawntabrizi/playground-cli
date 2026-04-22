import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOrCreateSessionAccount, readSessionAccount } from "./session-account.js";

describe("getOrCreateSessionAccount", () => {
    let tmp: string;
    let originalRoot: string | undefined;

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), "pg-session-account-"));
        originalRoot = process.env.POLKADOT_ROOT;
        process.env.POLKADOT_ROOT = tmp;
    });

    afterEach(() => {
        if (originalRoot === undefined) {
            delete process.env.POLKADOT_ROOT;
        } else {
            process.env.POLKADOT_ROOT = originalRoot;
        }
        rmSync(tmp, { recursive: true, force: true });
    });

    it("generates a new key on first call and persists the mnemonic", async () => {
        const { info, created } = await getOrCreateSessionAccount();

        expect(created).toBe(true);
        expect(info.mnemonic.split(" ").length).toBeGreaterThanOrEqual(12);
        expect(info.account.ss58Address).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
        expect(info.account.h160Address).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(typeof info.account.signer.signTx).toBe("function");

        const path = join(tmp, "accounts.json");
        expect(existsSync(path)).toBe(true);
        const stored = JSON.parse(readFileSync(path, "utf8"));
        expect(stored.default).toBe(info.mnemonic);
    });

    it("returns the same key on subsequent calls with created=false", async () => {
        const first = await getOrCreateSessionAccount();
        const second = await getOrCreateSessionAccount();

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.info.mnemonic).toBe(first.info.mnemonic);
        expect(second.info.account.ss58Address).toBe(first.info.account.ss58Address);
    });

    it("ignores garbage in the store and regenerates a valid key", async () => {
        const path = join(tmp, "accounts.json");
        await getOrCreateSessionAccount();
        const { writeFileSync } = await import("node:fs");
        writeFileSync(path, JSON.stringify({ default: { not: "a string" } }));

        const { info, created } = await getOrCreateSessionAccount();
        expect(created).toBe(true);
        expect(info.mnemonic.split(" ").length).toBeGreaterThanOrEqual(12);

        const stored = JSON.parse(readFileSync(path, "utf8"));
        expect(typeof stored.default).toBe("string");
    });
});

describe("readSessionAccount", () => {
    let tmp: string;
    let originalRoot: string | undefined;

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), "pg-session-read-"));
        originalRoot = process.env.POLKADOT_ROOT;
        process.env.POLKADOT_ROOT = tmp;
    });

    afterEach(() => {
        if (originalRoot === undefined) {
            delete process.env.POLKADOT_ROOT;
        } else {
            process.env.POLKADOT_ROOT = originalRoot;
        }
        rmSync(tmp, { recursive: true, force: true });
    });

    it("returns null when no key is persisted", async () => {
        expect(await readSessionAccount()).toBeNull();
    });

    it("returns the persisted key without creating a new one", async () => {
        const { info: created } = await getOrCreateSessionAccount();
        const loaded = await readSessionAccount();
        expect(loaded?.mnemonic).toBe(created.mnemonic);
        expect(loaded?.account.ss58Address).toBe(created.account.ss58Address);
    });

    it("does not create a file when the store is empty (read-only)", async () => {
        await readSessionAccount();
        const path = join(tmp, "accounts.json");
        expect(existsSync(path)).toBe(false);
    });
});
