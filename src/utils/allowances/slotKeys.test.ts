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

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { secretFromSeed } from "@scure/sr25519";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    _internal,
    createSlotAccountSigner,
    extractSlotAccountKey,
    getOrCreateSlotAccountKey,
    hasSlotAccountKey,
    readSlotAccountKey,
    storeSlotAccountKey,
    storeSlotAccountKeysFromOutcomes,
} from "./slotKeys.js";
import type { AllocationOutcome } from "./host.js";

const ADDR = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const KEY = secretFromSeed(new Uint8Array(32).fill(7));
const KEY_2 = secretFromSeed(new Uint8Array(32).fill(8));
const MINI_SECRET = new Uint8Array(32).fill(9);

function schnorrkelBytesFromScureSecret(secret: Uint8Array): Uint8Array {
    const raw = new Uint8Array(secret);
    let carry = 0;
    for (let i = 31; i >= 0; i--) {
        const value = secret[i] + carry * 256;
        raw[i] = value >> 3;
        carry = value & 0x07;
    }
    return raw;
}

let tempRoot: string;
let originalPolkadotRoot: string | undefined;

beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "allowances-keys-"));
    originalPolkadotRoot = process.env.POLKADOT_ROOT;
    process.env.POLKADOT_ROOT = tempRoot;
});

afterEach(async () => {
    if (originalPolkadotRoot === undefined) {
        delete process.env.POLKADOT_ROOT;
    } else {
        process.env.POLKADOT_ROOT = originalPolkadotRoot;
    }
    await rm(tempRoot, { recursive: true, force: true });
});

describe("slot account key cache", () => {
    it("stores and reads a key scoped by env/address/resource", async () => {
        await storeSlotAccountKey("paseo-next-v2", ADDR, "BulletInAllowance", KEY);

        expect(await hasSlotAccountKey("paseo-next-v2", ADDR, "BulletInAllowance")).toBe(true);
        expect(await readSlotAccountKey("paseo-next-v2", ADDR, "BulletInAllowance")).toEqual(KEY);
        expect(await hasSlotAccountKey("paseo-next", ADDR, "BulletInAllowance")).toBe(false);
        expect(await hasSlotAccountKey("paseo-next-v2", ADDR, "StatementStoreAllowance")).toBe(
            false,
        );
    });

    it("writes the key file under $POLKADOT_ROOT", async () => {
        await storeSlotAccountKey("paseo-next-v2", ADDR, "BulletInAllowance", KEY);

        expect(_internal.getKeyPath()).toBe(join(tempRoot, "allowance-keys.json"));
        const parsed = JSON.parse(await readFile(_internal.getKeyPath(), "utf8"));
        expect(parsed.envs["paseo-next-v2"][ADDR].BulletInAllowance.slotAccountKey).toMatch(
            /^0x[0-9a-f]+$/,
        );
    });

    it("extracts and stores normalized slot account keys from allocation outcomes", async () => {
        const mobileKey = schnorrkelBytesFromScureSecret(KEY);
        const mobileKey2 = schnorrkelBytesFromScureSecret(KEY_2);
        const outcomes: AllocationOutcome[] = [
            {
                tag: "Allocated",
                value: { tag: "BulletInAllowance", value: { slotAccountKey: mobileKey } },
            },
            {
                tag: "Allocated",
                value: { tag: "StatementStoreAllowance", value: { slotAccountKey: mobileKey2 } },
            },
            { tag: "Allocated", value: { tag: "SmartContractAllowance", value: undefined } },
        ];

        expect(extractSlotAccountKey(outcomes, "BulletInAllowance")).toEqual(KEY);
        await storeSlotAccountKeysFromOutcomes("paseo-next-v2", ADDR, outcomes);
        expect(await readSlotAccountKey("paseo-next-v2", ADDR, "BulletInAllowance")).toEqual(KEY);
        expect(await readSlotAccountKey("paseo-next-v2", ADDR, "StatementStoreAllowance")).toEqual(
            KEY_2,
        );
    });

    it("preserves sibling slot keys when multiple resources are returned at once", async () => {
        // Regression guard: the previous implementation looped via
        // Promise.all(...storeSlotAccountKey) and each save read+wrote
        // the file, so concurrent saves clobbered each other's writes
        // and the second-returned sibling key would be dropped. The
        // batched read-modify-write must keep both keys.
        const otherKey = secretFromSeed(new Uint8Array(32).fill(13));
        const mobileKey = schnorrkelBytesFromScureSecret(KEY);
        const otherMobileKey = schnorrkelBytesFromScureSecret(otherKey);
        const outcomes: AllocationOutcome[] = [
            {
                tag: "Allocated",
                value: { tag: "BulletInAllowance", value: { slotAccountKey: mobileKey } },
            },
            {
                tag: "Allocated",
                value: {
                    tag: "StatementStoreAllowance",
                    value: { slotAccountKey: otherMobileKey },
                },
            },
        ];

        await storeSlotAccountKeysFromOutcomes("paseo-next-v2", ADDR, outcomes);

        expect(await readSlotAccountKey("paseo-next-v2", ADDR, "BulletInAllowance")).toEqual(KEY);
        expect(await readSlotAccountKey("paseo-next-v2", ADDR, "StatementStoreAllowance")).toEqual(
            otherKey,
        );
    });

    it("creates a signer from a raw slot account key", async () => {
        const signer = createSlotAccountSigner(KEY);

        expect(signer.publicKey).toHaveLength(32);
        await expect(signer.signBytes(new Uint8Array([1, 2, 3]))).resolves.toHaveLength(64);
    });

    it("creates a signer from a 32-byte mini-secret slot account key", async () => {
        const signer = createSlotAccountSigner(MINI_SECRET);

        expect(signer.publicKey).toHaveLength(32);
        await expect(signer.signBytes(new Uint8Array([1, 2, 3]))).resolves.toHaveLength(64);
    });

    it("creates and then reuses a local slot key when none is cached", async () => {
        const first = await getOrCreateSlotAccountKey("paseo-next-v2", ADDR, "BulletInAllowance");
        const second = await getOrCreateSlotAccountKey("paseo-next-v2", ADDR, "BulletInAllowance");

        expect(first).toHaveLength(64);
        expect(second).toEqual(first);
    });
});
