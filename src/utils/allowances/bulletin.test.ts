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

const { checkAuthorizationMock, requestResourceAllocationMock, markAllowanceMock } = vi.hoisted(
    () => ({
        checkAuthorizationMock: vi.fn(),
        requestResourceAllocationMock: vi.fn(),
        markAllowanceMock: vi.fn(),
    }),
);

vi.mock("@parity/product-sdk-bulletin", () => ({
    checkAuthorization: checkAuthorizationMock,
}));

vi.mock("./host.js", () => ({
    requestResourceAllocation: requestResourceAllocationMock,
}));

vi.mock("./marker.js", () => ({
    markAllowance: markAllowanceMock,
}));

import {
    getBulletinAllowanceSigner,
    hasUsableBulletinSlotAuthorization,
    requestAndStoreBulletinAllowanceSigner,
} from "./bulletin.js";
import { readSlotAccountKey, storeSlotAccountKey } from "./slotKeys.js";

const KEY = secretFromSeed(new Uint8Array(32).fill(7));
const KEY_2 = secretFromSeed(new Uint8Array(32).fill(8));
const ENV = "paseo-next-v2";
const OWNER = "5Owner";
const PRODUCT_ID = "playground.dot";

let root: string | null = null;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "playground-cli-allowances-"));
    process.env.POLKADOT_ROOT = root;
    checkAuthorizationMock.mockReset();
    requestResourceAllocationMock.mockReset();
    markAllowanceMock.mockReset();
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

    it("stores the returned slot key before waiting for Bulletin propagation", async () => {
        requestResourceAllocationMock.mockResolvedValueOnce([
            {
                tag: "Allocated",
                value: {
                    tag: "BulletInAllowance",
                    value: { slotAccountKey: KEY },
                },
            },
        ]);
        checkAuthorizationMock.mockRejectedValueOnce(new Error("rpc unavailable"));

        await expect(
            requestAndStoreBulletinAllowanceSigner({
                env: ENV,
                ownerAddress: OWNER,
                productId: PRODUCT_ID,
                publishSigner: {
                    source: "session",
                    address: OWNER,
                    userSession: {} as any,
                    signer: {} as any,
                    destroy() {},
                },
                bulletinApi: {} as any,
                policy: "Ignore",
            }),
        ).rejects.toThrow("rpc unavailable");

        await expect(readSlotAccountKey(ENV, OWNER, "BulletInAllowance")).resolves.toEqual(KEY);
        expect(markAllowanceMock).not.toHaveBeenCalled();
    });

    it("requests an increased allocation when a cached slot key is live but out of quota", async () => {
        await storeSlotAccountKey(ENV, OWNER, "BulletInAllowance", KEY);
        const userSession = {};
        const requestedPolicies: string[] = [];

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
        requestResourceAllocationMock.mockResolvedValueOnce([
            {
                tag: "Allocated",
                value: {
                    tag: "BulletInAllowance",
                    value: { slotAccountKey: KEY_2 },
                },
            },
        ]);

        await getBulletinAllowanceSigner({
            env: ENV,
            ownerAddress: OWNER,
            productId: PRODUCT_ID,
            publishSigner: {
                source: "session",
                address: OWNER,
                userSession: userSession as any,
                signer: {} as any,
                destroy() {},
            },
            bulletinApi: {} as any,
            requiredBytes: 50,
            onRequest: (policy) => requestedPolicies.push(policy),
        });

        expect(requestedPolicies).toEqual(["Increase"]);
        expect(requestResourceAllocationMock).toHaveBeenCalledWith(
            userSession,
            PRODUCT_ID,
            [{ tag: "BulletInAllowance", value: undefined }],
            "Increase",
        );
    });
});
