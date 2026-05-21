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

import { getBulletinAllowanceSigner, hasUsableBulletinSlotAuthorization } from "./bulletin.js";
import { readSlotAccountKey, storeSlotAccountKey } from "./slotKeys.js";

const KEY = secretFromSeed(new Uint8Array(32).fill(7));
const KEY_2 = secretFromSeed(new Uint8Array(32).fill(8));
const MOBILE_KEY = schnorrkelBytesFromScureSecret(KEY);
const MOBILE_KEY_2 = schnorrkelBytesFromScureSecret(KEY_2);
const ENV = "paseo-next-v2";
const OWNER = "5Owner";

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

    it("normalizes and uses a mobile-returned slot key when none is cached", async () => {
        const owner = `${OWNER}-mobile`;
        const requestResourceAllocation = vi.fn(async () => ({
            isErr: () => false,
            value: [
                {
                    tag: "Allocated",
                    value: {
                        tag: "BulletInAllowance",
                        value: { slotAccountKey: MOBILE_KEY },
                    },
                },
            ],
        }));
        checkAuthorizationMock.mockResolvedValueOnce({
            authorized: true,
            remainingTransactions: 1,
            remainingBytes: 100n,
            expiration: 1,
        });
        await expect(readSlotAccountKey(ENV, owner, "BulletInAllowance")).resolves.toBeNull();

        const signer = await getBulletinAllowanceSigner({
            env: ENV,
            ownerAddress: owner,
            publishSigner: {
                source: "session",
                address: owner,
                signer: {} as any,
                userSession: { requestResourceAllocation } as any,
                destroy() {},
            },
            bulletinApi: {} as any,
            requiredBytes: 50,
        });

        expect(requestResourceAllocation).toHaveBeenCalledWith({
            callingProductId: "playground.dot",
            resources: [{ tag: "BulletInAllowance", value: undefined }],
            onExisting: "Ignore",
        });
        expect(signer.publicKey).toHaveLength(32);
        await expect(readSlotAccountKey(ENV, owner, "BulletInAllowance")).resolves.toEqual(KEY);
    });

    it("requests an additional Bulletin slot when cached authorization lacks quota", async () => {
        await storeSlotAccountKey(ENV, OWNER, "BulletInAllowance", KEY);
        const requestResourceAllocation = vi.fn(async () => ({
            isErr: () => false,
            value: [
                {
                    tag: "Allocated",
                    value: {
                        tag: "BulletInAllowance",
                        value: { slotAccountKey: MOBILE_KEY },
                    },
                },
            ],
        }));
        checkAuthorizationMock
            .mockResolvedValueOnce({
                authorized: true,
                remainingTransactions: 0,
                remainingBytes: 100n,
                expiration: 1,
            })
            .mockResolvedValueOnce({
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
                userSession: { requestResourceAllocation } as any,
                destroy() {},
            },
            bulletinApi: {} as any,
            requiredBytes: 50,
        });

        expect(requestResourceAllocation).toHaveBeenCalledWith({
            callingProductId: "playground.dot",
            resources: [{ tag: "BulletInAllowance", value: undefined }],
            onExisting: "Increase",
        });
        expect(signer.publicKey).toHaveLength(32);
    });

    it("syncs with mobile when the cached slot key is not authorized", async () => {
        await storeSlotAccountKey(ENV, OWNER, "BulletInAllowance", KEY);
        const requestResourceAllocation = vi.fn(async () => ({
            isErr: () => false,
            value: [
                {
                    tag: "Allocated",
                    value: {
                        tag: "BulletInAllowance",
                        value: { slotAccountKey: MOBILE_KEY_2 },
                    },
                },
            ],
        }));
        checkAuthorizationMock
            .mockResolvedValueOnce({
                authorized: false,
                remainingTransactions: 0,
                remainingBytes: 0n,
                expiration: 0,
            })
            .mockResolvedValueOnce({
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
                userSession: { requestResourceAllocation } as any,
                destroy() {},
            },
            bulletinApi: {} as any,
            requiredBytes: 50,
        });

        expect(requestResourceAllocation).toHaveBeenCalledWith({
            callingProductId: "playground.dot",
            resources: [{ tag: "BulletInAllowance", value: undefined }],
            onExisting: "Ignore",
        });
        expect(signer.publicKey).toHaveLength(32);
        await expect(readSlotAccountKey(ENV, OWNER, "BulletInAllowance")).resolves.toEqual(KEY_2);
    });

    it("points back to mobile approval when the cached slot key is not authorized", async () => {
        await storeSlotAccountKey(ENV, OWNER, "BulletInAllowance", KEY);
        const requestResourceAllocation = vi.fn(async () => ({
            isErr: () => false,
            value: [{ tag: "Rejected", value: undefined }],
        }));
        checkAuthorizationMock.mockResolvedValue({
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
                    userSession: { requestResourceAllocation } as any,
                    destroy() {},
                },
                bulletinApi: {} as any,
                requiredBytes: 50,
            }),
        ).rejects.toThrow(/Re-run `dot init` and approve on your phone/);
        expect(requestResourceAllocation).toHaveBeenCalledWith({
            callingProductId: "playground.dot",
            resources: [{ tag: "BulletInAllowance", value: undefined }],
            onExisting: "Ignore",
        });
    });
});
