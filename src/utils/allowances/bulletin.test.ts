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
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkAuthorizationMock } = vi.hoisted(() => ({
    checkAuthorizationMock: vi.fn(),
}));

vi.mock("@parity/product-sdk-bulletin", () => ({
    checkAuthorization: checkAuthorizationMock,
}));

import { hasUsableBulletinSlotAuthorization } from "./bulletin.js";

const KEY = secretFromSeed(new Uint8Array(32).fill(7));

beforeEach(() => {
    checkAuthorizationMock.mockReset();
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
});
