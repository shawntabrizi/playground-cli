// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    getOrCreateSessionAccount,
    persistSessionAccount,
    readSessionAccount,
} from "./session-account.js";

// ── getOrCreateSessionAccount ────────────────────────────────────────────────

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

    it("returns created=true and a valid key on first call", async () => {
        const { info, created } = await getOrCreateSessionAccount();

        expect(created).toBe(true);
        expect(info.mnemonic.split(" ").length).toBeGreaterThanOrEqual(12);
        expect(info.account.ss58Address).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
        expect(info.account.h160Address).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(typeof info.account.signer.signTx).toBe("function");
    });

    it("does NOT write accounts.json before persistSessionAccount is called", async () => {
        await getOrCreateSessionAccount();

        const path = join(tmp, "accounts.json");
        expect(existsSync(path)).toBe(false);
    });

    it("returns created=false and existing key when file already has a key", async () => {
        // Seed the file via persist on the first creation.
        const first = await getOrCreateSessionAccount();
        await persistSessionAccount(first.info);

        const second = await getOrCreateSessionAccount();

        expect(second.created).toBe(false);
        expect(second.info.mnemonic).toBe(first.info.mnemonic);
        expect(second.info.account.ss58Address).toBe(first.info.account.ss58Address);
    });

    it("returns created=true (new key) on retry when file was never written (map_account failed)", async () => {
        // Simulate: first create, map_account throws → no persist → retry.
        const first = await getOrCreateSessionAccount();
        expect(first.created).toBe(true);

        // map_account failed; we never called persistSessionAccount.
        // On retry getOrCreateSessionAccount should mint a fresh key.
        const retry = await getOrCreateSessionAccount();
        expect(retry.created).toBe(true);
        // A fresh mnemonic is generated each time.
        expect(retry.info.mnemonic).not.toBe(first.info.mnemonic);
    });

    it("ignores garbage in the store and returns a fresh key", async () => {
        const path = join(tmp, "accounts.json");
        // Write garbage into the file to simulate corruption.
        const { writeFileSync, mkdirSync } = await import("node:fs");
        const { dirname } = await import("node:path");
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({ default: { not: "a string" } }));

        const { info, created } = await getOrCreateSessionAccount();
        expect(created).toBe(true);
        expect(info.mnemonic.split(" ").length).toBeGreaterThanOrEqual(12);

        // The garbage file is still there; it should not have been overwritten.
        const stored = JSON.parse(readFileSync(path, "utf8"));
        expect(typeof stored.default).not.toBe("string");
    });
});

// ── persistSessionAccount ────────────────────────────────────────────────────

describe("persistSessionAccount", () => {
    let tmp: string;
    let originalRoot: string | undefined;

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), "pg-session-persist-"));
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

    it("writes accounts.json with the mnemonic under the 'default' key", async () => {
        const { info } = await getOrCreateSessionAccount();
        await persistSessionAccount(info);

        const path = join(tmp, "accounts.json");
        expect(existsSync(path)).toBe(true);
        const stored = JSON.parse(readFileSync(path, "utf8"));
        expect(stored.default).toBe(info.mnemonic);
    });

    it("after persist, getOrCreateSessionAccount returns created=false", async () => {
        const { info } = await getOrCreateSessionAccount();
        await persistSessionAccount(info);

        const second = await getOrCreateSessionAccount();
        expect(second.created).toBe(false);
        expect(second.info.mnemonic).toBe(info.mnemonic);
    });

    it("map_account-fails scenario: no persist → retry mints new key and re-maps", async () => {
        // Step 1: create key in memory (map_account would be attempted here).
        const attempt1 = await getOrCreateSessionAccount();
        expect(attempt1.created).toBe(true);

        // Step 2: map_account throws — do NOT call persistSessionAccount.
        // (No action needed — file is untouched.)

        // Step 3: retry — should produce a fresh key with created=true.
        const attempt2 = await getOrCreateSessionAccount();
        expect(attempt2.created).toBe(true);
        // It's a different key, so the retry path would re-attempt map_account.
        expect(attempt2.info.mnemonic).not.toBe(attempt1.info.mnemonic);

        // Step 4: map_account succeeds — now persist.
        await persistSessionAccount(attempt2.info);

        // Step 5: subsequent call loads from disk.
        const loaded = await getOrCreateSessionAccount();
        expect(loaded.created).toBe(false);
        expect(loaded.info.mnemonic).toBe(attempt2.info.mnemonic);
    });
});

// ── readSessionAccount ────────────────────────────────────────────────────────

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
        const { info } = await getOrCreateSessionAccount();
        await persistSessionAccount(info);

        const loaded = await readSessionAccount();
        expect(loaded?.mnemonic).toBe(info.mnemonic);
        expect(loaded?.account.ss58Address).toBe(info.account.ss58Address);
    });

    it("does not create a file when the store is empty (read-only)", async () => {
        await readSessionAccount();
        const path = join(tmp, "accounts.json");
        expect(existsSync(path)).toBe(false);
    });
});
