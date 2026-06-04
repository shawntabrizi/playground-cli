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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedSigner } from "../signer.js";

// SDK boundary mocks — these are our wrappers over RFC-0010 + Bulletin, NOT
// polkadot-api primitives, so mocking them is allowed.
const {
    checkAuthorizationMock,
    createSlotAccountSignerMock,
    ensureSlotAccountSignerMock,
    requestResourceAllocationMock,
    readCachedBulletinSlotSignerMock,
} = vi.hoisted(() => ({
    checkAuthorizationMock: vi.fn(),
    createSlotAccountSignerMock: vi.fn(),
    ensureSlotAccountSignerMock: vi.fn(),
    requestResourceAllocationMock: vi.fn(),
    readCachedBulletinSlotSignerMock: vi.fn(),
}));

vi.mock("@parity/product-sdk-cloud-storage", () => ({
    checkAuthorization: checkAuthorizationMock,
}));

vi.mock("@parity/product-sdk-terminal/host", () => ({
    createSlotAccountSigner: createSlotAccountSignerMock,
    ensureSlotAccountSigner: ensureSlotAccountSignerMock,
    requestResourceAllocation: requestResourceAllocationMock,
}));

vi.mock("./slotSigner.js", () => ({
    readCachedBulletinSlotSigner: readCachedBulletinSlotSignerMock,
}));

import {
    cachedBulletinSlotAuthorization,
    getBulletinAllowanceSigner,
    getBulletinSlotAuthorization,
} from "./bulletin.js";

// A 32-byte public key (filled with 1) deterministically encodes to a known
// SS58 — we only assert it is non-empty, since the encoding is the SDK's job.
const PUBLIC_KEY = new Uint8Array(32).fill(1);
const SLOT_SIGNER = { publicKey: PUBLIC_KEY } as any;

const ENV_HINT = /playground init/;

function sessionSigner(): ResolvedSigner {
    return {
        source: "session",
        address: "5Owner",
        signer: {} as any,
        userSession: {} as any,
        adapter: {} as any,
        destroy() {},
    };
}

function devSigner(): ResolvedSigner {
    return {
        source: "dev",
        address: "5Dev",
        signer: { publicKey: PUBLIC_KEY } as any,
        destroy() {},
    };
}

beforeEach(() => {
    checkAuthorizationMock.mockReset();
    createSlotAccountSignerMock.mockReset();
    ensureSlotAccountSignerMock.mockReset();
    requestResourceAllocationMock.mockReset();
    readCachedBulletinSlotSignerMock.mockReset();
    // Default: no local cache read available — every existing test exercises
    // the SDK-signer fallback path unchanged.
    readCachedBulletinSlotSignerMock.mockResolvedValue(null);
});

describe("getBulletinAllowanceSigner", () => {
    it("passes through the local signer for dev/SURI deploys without any SDK calls", async () => {
        const dev = devSigner();
        const signer = await getBulletinAllowanceSigner({ publishSigner: dev });
        expect(signer).toBe(dev.signer);
        expect(ensureSlotAccountSignerMock).not.toHaveBeenCalled();
        expect(requestResourceAllocationMock).not.toHaveBeenCalled();
    });

    it("throws the init hint when there is no session/adapter", async () => {
        await expect(
            getBulletinAllowanceSigner({
                publishSigner: {
                    source: "session",
                    address: "5Owner",
                    signer: {} as any,
                    destroy() {},
                },
            }),
        ).rejects.toThrow(ENV_HINT);
    });

    it("returns the slot signer when its on-chain authorization is usable", async () => {
        ensureSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        checkAuthorizationMock.mockResolvedValue({
            authorized: true,
            remainingTransactions: 1,
            remainingBytes: 100n,
            expiration: 1,
        });

        const signer = await getBulletinAllowanceSigner({
            publishSigner: sessionSigner(),
            bulletinApi: {} as any,
            requiredBytes: 50,
        });

        expect(signer).toBe(SLOT_SIGNER);
        expect(requestResourceAllocationMock).not.toHaveBeenCalled();
    });

    it("returns the slot signer without checking authorization when no bulletinApi is supplied", async () => {
        ensureSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);

        const signer = await getBulletinAllowanceSigner({ publishSigner: sessionSigner() });

        expect(signer).toBe(SLOT_SIGNER);
        expect(checkAuthorizationMock).not.toHaveBeenCalled();
    });

    it("requests an Increase once when the slot is authorized but out of quota, then succeeds", async () => {
        ensureSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        requestResourceAllocationMock.mockResolvedValue([]);
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
            publishSigner: sessionSigner(),
            bulletinApi: {} as any,
            requiredBytes: 50,
        });

        expect(signer).toBe(SLOT_SIGNER);
        expect(requestResourceAllocationMock).toHaveBeenCalledTimes(1);
        expect(requestResourceAllocationMock).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            [{ tag: "BulletInAllowance", value: undefined }],
            { onExisting: "Increase" },
        );
    });

    it("throws the quota error when still unusable after an Increase", async () => {
        ensureSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        requestResourceAllocationMock.mockResolvedValue([]);
        checkAuthorizationMock.mockResolvedValue({
            authorized: true,
            remainingTransactions: 0,
            remainingBytes: 100n,
            expiration: 1,
        });

        await expect(
            getBulletinAllowanceSigner({
                publishSigner: sessionSigner(),
                bulletinApi: {} as any,
                requiredBytes: 50,
            }),
        ).rejects.toThrow(/does not have enough quota/);
    });

    it("throws the not-authorized error when the slot is not authorized on-chain", async () => {
        ensureSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        checkAuthorizationMock.mockResolvedValue({
            authorized: false,
            remainingTransactions: 0,
            remainingBytes: 0n,
            expiration: 0,
        });

        await expect(
            getBulletinAllowanceSigner({
                publishSigner: sessionSigner(),
                bulletinApi: {} as any,
                requiredBytes: 50,
            }),
        ).rejects.toThrow(/not authorized on-chain yet/);
        // Never authorized → no Increase attempt (Increase only fires when authorized).
        expect(requestResourceAllocationMock).not.toHaveBeenCalled();
    });
});

describe("getBulletinAllowanceSigner — corrected slot derivation", () => {
    // The SDK's createSlotAccountSigner derives the WRONG public key for
    // 64-byte phone-issued keys (missing schnorrkel x8 normalization), so the
    // signer actually used must come from readCachedBulletinSlotSigner. The
    // pubkeys differ so the assertions can prove which one won.
    const CORRECTED_PUBLIC_KEY = new Uint8Array(32).fill(9);
    const CORRECTED_SIGNER = { publicKey: CORRECTED_PUBLIC_KEY } as any;

    it("prefers the cache-derived signer over the SDK's mis-derived one", async () => {
        ensureSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        readCachedBulletinSlotSignerMock.mockResolvedValue(CORRECTED_SIGNER);

        const signer = await getBulletinAllowanceSigner({ publishSigner: sessionSigner() });

        expect(signer).toBe(CORRECTED_SIGNER);
        // The SDK ensure call still runs first — it owns allocation + caching.
        expect(ensureSlotAccountSignerMock).toHaveBeenCalledTimes(1);
    });

    it("reads the cache from the ADAPTER's storage dir and appId, not hardcoded defaults", async () => {
        // ensureSlotAccountSigner writes its cache to the adapter's storage
        // namespace. Reading from a hardcoded ~/.polkadot-apps/dot-cli_* path
        // would silently fall back to the SDK's wrong-address signer the
        // moment an adapter uses a custom storageDir or appId — re-arming the
        // exact bug the corrected derivation exists to fix.
        ensureSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        readCachedBulletinSlotSignerMock.mockResolvedValue(CORRECTED_SIGNER);
        const adapter = { appId: "custom-app", storageDir: "/custom/dir" } as any;
        const publishSigner = { ...sessionSigner(), adapter };

        await getBulletinAllowanceSigner({ publishSigner });

        expect(readCachedBulletinSlotSignerMock).toHaveBeenCalledWith("/custom/dir", "custom-app");
    });

    it("runs the authorization check against the corrected address, not the SDK's", async () => {
        ensureSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        readCachedBulletinSlotSignerMock.mockResolvedValue(CORRECTED_SIGNER);
        checkAuthorizationMock.mockResolvedValue({
            authorized: true,
            remainingTransactions: 1,
            remainingBytes: 100n,
            expiration: 1,
        });

        await getBulletinAllowanceSigner({
            publishSigner: sessionSigner(),
            bulletinApi: {} as any,
            requiredBytes: 50,
        });

        const checkedAddress = checkAuthorizationMock.mock.calls[0][1] as string;
        const { ss58Encode } = await import("@parity/product-sdk-address");
        expect(checkedAddress).toBe(ss58Encode(CORRECTED_PUBLIC_KEY));
        expect(checkedAddress).not.toBe(ss58Encode(PUBLIC_KEY));
    });
});

describe("cachedBulletinSlotAuthorization", () => {
    it("checks the corrected address when the cache is readable", async () => {
        const CORRECTED = { publicKey: new Uint8Array(32).fill(9) } as any;
        createSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        readCachedBulletinSlotSignerMock.mockResolvedValue(CORRECTED);
        checkAuthorizationMock.mockResolvedValue({
            authorized: true,
            remainingTransactions: 1,
            remainingBytes: 100n,
            expiration: 1,
        });

        const result = await cachedBulletinSlotAuthorization({} as any, {} as any, 50);

        const { ss58Encode } = await import("@parity/product-sdk-address");
        expect(result?.address).toBe(ss58Encode(new Uint8Array(32).fill(9)));
    });

    it("returns null on a cache miss without touching the wire", async () => {
        createSlotAccountSignerMock.mockResolvedValue(null);

        const result = await cachedBulletinSlotAuthorization({} as any, {} as any, 1);

        expect(result).toBeNull();
        expect(checkAuthorizationMock).not.toHaveBeenCalled();
    });

    it("returns the on-chain authorization for a cached slot key", async () => {
        createSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        checkAuthorizationMock.mockResolvedValue({
            authorized: true,
            remainingTransactions: 1,
            remainingBytes: 100n,
            expiration: 1,
        });

        const result = await cachedBulletinSlotAuthorization({} as any, {} as any, 50);

        expect(result?.usable).toBe(true);
    });
});

describe("getBulletinSlotAuthorization", () => {
    it("encodes the signer public key and flags usability", async () => {
        checkAuthorizationMock.mockResolvedValue({
            authorized: true,
            remainingTransactions: 1,
            remainingBytes: 100n,
            expiration: 1,
        });

        const result = await getBulletinSlotAuthorization({} as any, SLOT_SIGNER, 50);

        expect(result.usable).toBe(true);
        expect(result.address).toMatch(/^5/);
        expect(checkAuthorizationMock).toHaveBeenCalledWith({}, result.address);
    });
});
