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
    hasSlotAccountKey,
    readSlotAccountKey,
    storeSlotAccountKey,
    storeSlotAccountKeysFromOutcomes,
} from "./slotKeys.js";
import type { AllocationOutcome } from "./host.js";

const ADDR = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const KEY = secretFromSeed(new Uint8Array(32).fill(7));
const KEY_2 = secretFromSeed(new Uint8Array(32).fill(8));

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

    it("extracts and stores slot account keys from allocation outcomes", async () => {
        const outcomes: AllocationOutcome[] = [
            {
                tag: "Allocated",
                value: { tag: "BulletInAllowance", value: { slotAccountKey: KEY } },
            },
            {
                tag: "Allocated",
                value: { tag: "StatementStoreAllowance", value: { slotAccountKey: KEY_2 } },
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

    it("creates a signer from a raw slot account key", async () => {
        const signer = createSlotAccountSigner(KEY);

        expect(signer.publicKey).toHaveLength(32);
        await expect(signer.signBytes(new Uint8Array([1, 2, 3]))).resolves.toHaveLength(64);
    });
});
