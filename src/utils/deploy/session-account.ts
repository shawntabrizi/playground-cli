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

/**
 * On-disk session key used to sign contracts-phase extrinsics.
 * Persisted at `$POLKADOT_ROOT/accounts.json` (default `~/.polkadot/accounts.json`)
 * with mode 0600 under a 0700 parent so the BIP39 phrase isn't world-readable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { SessionKeyManager, type SessionKeyInfo } from "@parity/product-sdk-keys";
import type { KvStore } from "@parity/product-sdk-storage";

export type { SessionKeyInfo };

/** 0.5 PAS — below this the contracts session key needs a top-up. */
export const SESSION_MIN_BALANCE = 5_000_000_000n;

/** 5 PAS — amount sent to top the session key up. */
export const SESSION_FUND_AMOUNT = 50_000_000_000n;

/** Root directory for playground-cli user state. Override with `$POLKADOT_ROOT`. */
export function defaultRoot(): string {
    return process.env.POLKADOT_ROOT ?? resolve(homedir(), ".polkadot");
}

function accountsPath(root = defaultRoot()): string {
    return resolve(root, "accounts.json");
}

/** Filesystem-backed KvStore for SessionKeyManager. */
class FileKvStore implements KvStore {
    constructor(private readonly path: string) {}

    private readAll(): Record<string, string> {
        if (!existsSync(this.path)) return {};
        try {
            const parsed = JSON.parse(readFileSync(this.path, "utf8"));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                const out: Record<string, string> = {};
                for (const [k, v] of Object.entries(parsed)) {
                    if (typeof v === "string") out[k] = v;
                }
                return out;
            }
        } catch {}
        return {};
    }

    private writeAll(obj: Record<string, string>): void {
        mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
        writeFileSync(this.path, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 });
    }

    async get(key: string): Promise<string | null> {
        return this.readAll()[key] ?? null;
    }

    async set(key: string, value: string): Promise<void> {
        const obj = this.readAll();
        obj[key] = value;
        this.writeAll(obj);
    }

    async remove(key: string): Promise<void> {
        const obj = this.readAll();
        delete obj[key];
        this.writeAll(obj);
    }

    async getJSON<T>(key: string): Promise<T | null> {
        const raw = await this.get(key);
        return raw === null ? null : (JSON.parse(raw) as T);
    }

    async setJSON(key: string, value: unknown): Promise<void> {
        await this.set(key, JSON.stringify(value));
    }
}

/** In-memory KvStore — used to mint a session key without touching disk. */
class InMemoryKvStore implements KvStore {
    private readonly data: Record<string, string> = {};

    async get(key: string): Promise<string | null> {
        return this.data[key] ?? null;
    }

    async set(key: string, value: string): Promise<void> {
        this.data[key] = value;
    }

    async remove(key: string): Promise<void> {
        delete this.data[key];
    }

    async getJSON<T>(key: string): Promise<T | null> {
        const raw = await this.get(key);
        return raw === null ? null : (JSON.parse(raw) as T);
    }

    async setJSON(key: string, value: unknown): Promise<void> {
        await this.set(key, JSON.stringify(value));
    }
}

/** Read the persisted session key; returns null on a miss (does not mint). */
export async function readSessionAccount(): Promise<SessionKeyInfo | null> {
    const store = new FileKvStore(accountsPath());
    const manager = new SessionKeyManager({ store });
    return manager.get();
}

/**
 * Load the persisted session key, or mint a fresh one in memory on first call.
 *
 * `created` is true only on the minting call — callers MUST:
 * 1. Submit `Revive.map_account` on-chain (gated by `created === true`).
 * 2. Call `persistSessionAccount(info)` ONLY AFTER the extrinsic is confirmed.
 *
 * Keeping persist separate from create prevents the file from recording a key
 * whose on-chain mapping was never established.  If `map_account` fails, the
 * file is untouched so the next retry mints a fresh key and re-attempts mapping.
 */
export async function getOrCreateSessionAccount(): Promise<{
    info: SessionKeyInfo;
    created: boolean;
}> {
    const fileStore = new FileKvStore(accountsPath());
    const fileManager = new SessionKeyManager({ store: fileStore });
    const existing = await fileManager.get();
    if (existing) return { info: existing, created: false };

    // Mint in memory — do NOT write to disk yet. The caller must call
    // `persistSessionAccount` after `map_account` succeeds.
    const memManager = new SessionKeyManager({ store: new InMemoryKvStore() });
    return { info: await memManager.create(), created: true };
}

/**
 * Write a session key to disk.  Call this ONLY after the on-chain
 * `Revive.map_account` extrinsic for `info` has been confirmed.
 */
export async function persistSessionAccount(info: SessionKeyInfo): Promise<void> {
    const store = new FileKvStore(accountsPath());
    await store.set("default", info.mnemonic);
}
