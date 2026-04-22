/**
 * On-disk session key used to sign contracts-phase extrinsics.
 * Persisted at `$POLKADOT_ROOT/accounts.json` (default `~/.polkadot/accounts.json`)
 * with mode 0600 under a 0700 parent so the BIP39 phrase isn't world-readable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { SessionKeyManager, type SessionKeyInfo } from "@polkadot-apps/keys";
import type { KvStore } from "@polkadot-apps/storage";

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

/** Read the persisted session key; returns null on a miss (does not mint). */
export async function readSessionAccount(): Promise<SessionKeyInfo | null> {
    const store = new FileKvStore(accountsPath());
    const manager = new SessionKeyManager({ store });
    return manager.get();
}

/**
 * Load the persisted session key, or mint + save a fresh one on first call.
 * `created` is true only on the minting call — callers use it to gate the
 * one-time `Revive.map_account` bootstrap.
 */
export async function getOrCreateSessionAccount(): Promise<{
    info: SessionKeyInfo;
    created: boolean;
}> {
    const store = new FileKvStore(accountsPath());
    const manager = new SessionKeyManager({ store });
    const existing = await manager.get();
    if (existing) return { info: existing, created: false };
    return { info: await manager.create(), created: true };
}
