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
 * Host-side cache for RFC-0010 slot-account keys.
 *
 * This is intentionally small and isolated so it can be replaced by a
 * product-sdk-terminal host/preimage helper once the SDK owns terminal
 * allowance-key persistence. Until then the CLI is the Host for terminal
 * sessions: it receives scoped allowance private keys from mobile, stores
 * them locally, and uses them to sign Bulletin/SSS submissions.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getPublicKey, sign } from "@scure/sr25519";
import { AccountId } from "polkadot-api";
import { toHex, fromHex } from "polkadot-api/utils";
import { getPolkadotSigner } from "polkadot-api/signer";
import type { PolkadotSigner } from "polkadot-api";
import type { Env } from "../../config.js";
import type { AllocationOutcome, ResourceTag } from "./host.js";

export type SlotAccountResourceTag = Extract<
    ResourceTag,
    "BulletInAllowance" | "StatementStoreAllowance"
>;

const SLOT_KEY_RESOURCES: readonly SlotAccountResourceTag[] = [
    "BulletInAllowance",
    "StatementStoreAllowance",
];

interface KeyEntry {
    slotAccountKey: `0x${string}`;
    storedAt: number;
}

interface KeyFile {
    version: 1;
    envs: Partial<Record<Env, Record<string, Partial<Record<SlotAccountResourceTag, KeyEntry>>>>>;
}

const EMPTY: KeyFile = { version: 1, envs: {} };

function getRootDir(): string {
    return process.env.POLKADOT_ROOT ?? join(homedir(), ".polkadot");
}

function getKeyPath(): string {
    return join(getRootDir(), "allowance-keys.json");
}

async function loadFile(): Promise<KeyFile> {
    let raw: string;
    try {
        raw = await fs.readFile(getKeyPath(), "utf8");
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { ...EMPTY };
        throw err;
    }
    try {
        const parsed = JSON.parse(raw) as KeyFile;
        if (parsed && parsed.version === 1 && parsed.envs && typeof parsed.envs === "object") {
            return parsed;
        }
    } catch {
        // Treat a corrupt cache as empty. The Account Holder can return the
        // existing allocation key again under OnExisting=Ignore.
    }
    return { ...EMPTY };
}

async function saveFile(file: KeyFile): Promise<void> {
    await fs.mkdir(getRootDir(), { recursive: true, mode: 0o700 });
    await fs.writeFile(getKeyPath(), `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
}

function isSlotAccountResource(tag: ResourceTag): tag is SlotAccountResourceTag {
    return SLOT_KEY_RESOURCES.includes(tag as SlotAccountResourceTag);
}

function normalizeSlotAccountKey(key: Uint8Array): Uint8Array {
    if (key.length !== 64) {
        throw new Error(`Expected 64-byte sr25519 slot account key, got ${key.length} bytes`);
    }
    return new Uint8Array(key);
}

export async function readSlotAccountKey(
    env: Env,
    address: string,
    resource: SlotAccountResourceTag,
): Promise<Uint8Array | null> {
    const entry = (await loadFile()).envs[env]?.[address]?.[resource];
    if (!entry) return null;
    try {
        return normalizeSlotAccountKey(fromHex(entry.slotAccountKey));
    } catch {
        return null;
    }
}

export async function hasSlotAccountKey(
    env: Env,
    address: string,
    resource: SlotAccountResourceTag,
): Promise<boolean> {
    return (await readSlotAccountKey(env, address, resource)) !== null;
}

export async function storeSlotAccountKey(
    env: Env,
    address: string,
    resource: SlotAccountResourceTag,
    key: Uint8Array,
): Promise<void> {
    const file = await loadFile();
    const envBucket = file.envs[env] ?? {};
    const addrBucket = envBucket[address] ?? {};
    addrBucket[resource] = {
        slotAccountKey: toHex(normalizeSlotAccountKey(key)) as `0x${string}`,
        storedAt: Date.now(),
    };
    envBucket[address] = addrBucket;
    file.envs[env] = envBucket;
    await saveFile(file);
}

export function extractSlotAccountKey(
    outcomes: AllocationOutcome[],
    resource: SlotAccountResourceTag,
): Uint8Array | null {
    for (const outcome of outcomes) {
        if (outcome.tag !== "Allocated") continue;
        const allocated = outcome.value as
            | { tag?: ResourceTag; value?: { slotAccountKey?: Uint8Array } }
            | undefined;
        if (allocated?.tag !== resource) continue;
        const key = allocated.value?.slotAccountKey;
        return key instanceof Uint8Array ? normalizeSlotAccountKey(key) : null;
    }
    return null;
}

export async function storeSlotAccountKeysFromOutcomes(
    env: Env,
    address: string,
    outcomes: AllocationOutcome[],
): Promise<void> {
    // Single read-modify-write so two slot keys returned in one call
    // (e.g. BulletInAllowance + StatementStoreAllowance) can't race —
    // the old `Promise.all([...storeSlotAccountKey])` pattern had each
    // call load the file, mutate one resource, save the file; the
    // saves would interleave and the second write would clobber the
    // first slot key.
    const file = await loadFile();
    // One timestamp for the whole batch — these keys all came from the same
    // `requestResourceAllocation` round-trip and represent one cohort.
    const storedAt = Date.now();
    let mutated = false;

    for (const outcome of outcomes) {
        if (outcome.tag !== "Allocated") continue;
        const allocated = outcome.value as
            | { tag?: ResourceTag; value?: { slotAccountKey?: Uint8Array } }
            | undefined;
        if (!allocated?.tag || !isSlotAccountResource(allocated.tag)) continue;
        const key = allocated.value?.slotAccountKey;
        if (!(key instanceof Uint8Array)) continue;

        const envBucket = file.envs[env] ?? {};
        const addrBucket = envBucket[address] ?? {};
        addrBucket[allocated.tag] = {
            slotAccountKey: toHex(normalizeSlotAccountKey(key)) as `0x${string}`,
            storedAt,
        };
        envBucket[address] = addrBucket;
        file.envs[env] = envBucket;
        mutated = true;
    }

    if (mutated) await saveFile(file);
}

export function createSlotAccountSigner(slotAccountKey: Uint8Array): PolkadotSigner {
    const secret = normalizeSlotAccountKey(slotAccountKey);
    const publicKey = getPublicKey(secret);
    return getPolkadotSigner(publicKey, "Sr25519", (payload) => sign(secret, payload));
}

export function getSlotAccountAddress(slotAccountKey: Uint8Array): string {
    return AccountId().dec(getPublicKey(normalizeSlotAccountKey(slotAccountKey)));
}

/** Visible for tests; not part of the public API. @internal */
export const _internal = { getKeyPath, loadFile, saveFile };
