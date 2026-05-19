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

import { secretFromSeed } from "@scure/sr25519";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { checkAuthorizationMock } = vi.hoisted(() => ({
    checkAuthorizationMock: vi.fn(),
}));

vi.mock("@parity/product-sdk-bulletin", () => ({
    checkAuthorization: checkAuthorizationMock,
}));

import {
    bulletinAuthorizationHelp,
    getBulletinAllowanceSigner,
    hasUsableBulletinSlotAuthorization,
} from "./bulletin.js";
import { readSlotAccountKey, storeSlotAccountKey } from "./slotKeys.js";

const KEY = secretFromSeed(new Uint8Array(32).fill(7));
const ENV = "paseo-next-v2";
const OWNER = "5Owner";

let root: string | null = null;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "playground-cli-allowances-"));
    process.env.POLKADOT_ROOT = root;
    checkAuthorizationMock.mockReset();
});

afterEach(async () => {
    delete process.env.POLKADOT_ROOT;
    if (root) await rm(root, { recursive: true, force: true });
    root = null;
});

describe("Bulletin allowance authorization", () => {
    it("formats manual authorization help for slot-account recovery", () => {
        expect(bulletinAuthorizationHelp("5Slot")).toBe(
            "Open the Bulletin authorization faucet at https://paritytech.github.io/polkadot-bulletin-chain/authorizations and authorize account 5Slot, then re-run `dot init`.",
        );
    });

    it("checks the slot account address derived from the returned private key", async () => {
        checkAuthorizationMock.mockResolvedValue({
            authorized: true,
            remainingTransactions: 1,
            remainingBytes: 100n,
            expiration: 1,
        });

        await expect(hasUsableBulletinSlotAuthorization({} as any, KEY, 50)).resolves.toBe(true);
        expect(checkAuthorizationMock).toHaveBeenCalledWith(
            {},
            "5EsNLFaGe9XK5LzWH3i6eC2Wqv6YqZS1442N1C4yeSdP6uxy",
        );
    });

    it("rejects missing transaction or byte allowance", async () => {
        checkAuthorizationMock.mockResolvedValueOnce({
            authorized: true,
            remainingTransactions: 0,
            remainingBytes: 100n,
            expiration: 1,
        });
        await expect(hasUsableBulletinSlotAuthorization({} as any, KEY, 50)).resolves.toBe(false);

        checkAuthorizationMock.mockResolvedValueOnce({
            authorized: true,
            remainingTransactions: 1,
            remainingBytes: 49n,
            expiration: 1,
        });
        await expect(hasUsableBulletinSlotAuthorization({} as any, KEY, 50)).resolves.toBe(false);
    });

    it("uses a cached slot key when it has enough Bulletin authorization", async () => {
        await storeSlotAccountKey(ENV, OWNER, "BulletInAllowance", KEY);
        checkAuthorizationMock.mockResolvedValueOnce({
            authorized: true,
            remainingTransactions: 1,
            remainingBytes: 100n,
            expiration: 1,
        });

        const signer = await getBulletinAllowanceSigner({
            env: ENV,
            ownerAddress: OWNER,
            publishSigner: {
                source: "session",
                address: OWNER,
                signer: {} as any,
                destroy() {},
            },
            bulletinApi: {} as any,
            requiredBytes: 50,
        });

        expect(signer.publicKey).toHaveLength(32);
    });

    it("creates a local slot key and points to the faucet when it is not authorized", async () => {
        checkAuthorizationMock.mockResolvedValueOnce({
            authorized: false,
            remainingTransactions: 0,
            remainingBytes: 0n,
            expiration: 0,
        });

        await expect(
            getBulletinAllowanceSigner({
                env: ENV,
                ownerAddress: OWNER,
                publishSigner: {
                    source: "session",
                    address: OWNER,
                    signer: {} as any,
                    destroy() {},
                },
                bulletinApi: {} as any,
                requiredBytes: 50,
            }),
        ).rejects.toThrow(/Bulletin authorization faucet/);

        await expect(readSlotAccountKey(ENV, OWNER, "BulletInAllowance")).resolves.toHaveLength(64);
    });
});
