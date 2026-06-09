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
    getCachedAllocationMock,
    requestResourceAllocationMock,
} = vi.hoisted(() => ({
    checkAuthorizationMock: vi.fn(),
    createSlotAccountSignerMock: vi.fn(),
    ensureSlotAccountSignerMock: vi.fn(),
    getCachedAllocationMock: vi.fn(),
    requestResourceAllocationMock: vi.fn(),
}));

vi.mock("@parity/product-sdk-cloud-storage", () => ({
    checkAuthorization: checkAuthorizationMock,
}));

vi.mock("@parity/product-sdk-terminal/host", () => ({
    createSlotAccountSigner: createSlotAccountSignerMock,
    ensureSlotAccountSigner: ensureSlotAccountSignerMock,
    getCachedAllocation: getCachedAllocationMock,
    requestResourceAllocation: requestResourceAllocationMock,
}));

import {
    cachedBulletinSlotAuthorization,
    getBulletinAllowanceSigner,
    getCachedBulletinAllowanceSigner,
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
    getCachedAllocationMock.mockReset();
    requestResourceAllocationMock.mockReset();
    // Default: slot key already in the SDK cache, so ensureSlotAccountSigner
    // resolves silently and no grant prompt fires.
    getCachedAllocationMock.mockResolvedValue({ tag: "BulletInAllowance" });
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

describe("getBulletinAllowanceSigner — phone approval prompts", () => {
    // Allocation requests travel over the statement store outside any
    // PolkadotSigner, so the deploy TUI's signing proxy can't see them. The
    // onPrompt hook is the only "check your phone" surface for these taps —
    // these tests pin when it fires and when it must stay silent.
    function recordingPrompt() {
        const calls: Array<{ label: string; closed: "complete" | "fail" | null }> = [];
        const prompt = (label: string) => {
            const entry = { label, closed: null as "complete" | "fail" | null };
            calls.push(entry);
            return {
                complete: () => {
                    entry.closed = "complete";
                },
                fail: () => {
                    entry.closed = "fail";
                },
            };
        };
        return { calls, prompt };
    }

    it("stays silent when the slot key is cached and quota is fine", async () => {
        ensureSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        checkAuthorizationMock.mockResolvedValue({
            authorized: true,
            remainingTransactions: 1,
            remainingBytes: 100n,
            expiration: 1,
        });
        const { calls, prompt } = recordingPrompt();

        await getBulletinAllowanceSigner({
            publishSigner: sessionSigner(),
            bulletinApi: {} as any,
            requiredBytes: 50,
            onPrompt: prompt,
        });

        expect(calls).toEqual([]);
    });

    it("prompts for the grant on a slot-key cache miss and completes it", async () => {
        getCachedAllocationMock.mockResolvedValue(null);
        ensureSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        const { calls, prompt } = recordingPrompt();

        await getBulletinAllowanceSigner({ publishSigner: sessionSigner(), onPrompt: prompt });

        expect(calls).toEqual([{ label: "Grant Bulletin storage allowance", closed: "complete" }]);
    });

    it("fails the grant prompt when the allocation request throws", async () => {
        getCachedAllocationMock.mockResolvedValue(null);
        ensureSlotAccountSignerMock.mockRejectedValue(new Error("Rejected on phone"));
        const { calls, prompt } = recordingPrompt();

        await expect(
            getBulletinAllowanceSigner({ publishSigner: sessionSigner(), onPrompt: prompt }),
        ).rejects.toThrow("Rejected on phone");

        expect(calls).toEqual([{ label: "Grant Bulletin storage allowance", closed: "fail" }]);
    });

    it("prompts for the Increase when the slot is authorized but out of quota", async () => {
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
        const { calls, prompt } = recordingPrompt();

        await getBulletinAllowanceSigner({
            publishSigner: sessionSigner(),
            bulletinApi: {} as any,
            requiredBytes: 50,
            onPrompt: prompt,
        });

        expect(calls).toEqual([
            { label: "Increase Bulletin storage allowance", closed: "complete" },
        ]);
    });

    it("fails the Increase prompt when the allocation request throws", async () => {
        ensureSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        requestResourceAllocationMock.mockRejectedValue(new Error("declined"));
        checkAuthorizationMock.mockResolvedValue({
            authorized: true,
            remainingTransactions: 0,
            remainingBytes: 100n,
            expiration: 1,
        });
        const { calls, prompt } = recordingPrompt();

        await expect(
            getBulletinAllowanceSigner({
                publishSigner: sessionSigner(),
                bulletinApi: {} as any,
                requiredBytes: 50,
                onPrompt: prompt,
            }),
        ).rejects.toThrow("declined");

        expect(calls).toEqual([{ label: "Increase Bulletin storage allowance", closed: "fail" }]);
    });
});

describe("getBulletinAllowanceSigner — SDK signer passthrough", () => {
    // terminal 0.3.1+ owns the schnorrkel-normalized derivation for 64-byte
    // phone-issued keys (the playground-cli slotSigner.ts workaround was
    // deleted once the fix shipped upstream). The SDK-built signer must be
    // used as-is, and the authorization check must run against ITS address.
    it("uses the SDK-built slot signer and checks authorization on its address", async () => {
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
        expect(ensureSlotAccountSignerMock).toHaveBeenCalledTimes(1);
        const checkedAddress = checkAuthorizationMock.mock.calls[0][1] as string;
        const { ss58Encode } = await import("@parity/product-sdk-address");
        expect(checkedAddress).toBe(ss58Encode(PUBLIC_KEY));
    });
});

describe("getCachedBulletinAllowanceSigner", () => {
    it("passes through the local signer for dev/SURI deploys without any SDK calls", async () => {
        const dev = devSigner();

        const signer = await getCachedBulletinAllowanceSigner({ publishSigner: dev });

        expect(signer).toBe(dev.signer);
        expect(createSlotAccountSignerMock).not.toHaveBeenCalled();
        expect(ensureSlotAccountSignerMock).not.toHaveBeenCalled();
        expect(requestResourceAllocationMock).not.toHaveBeenCalled();
    });

    it("fails with the init hint on a cache miss without requesting allocation", async () => {
        createSlotAccountSignerMock.mockResolvedValue(null);

        await expect(
            getCachedBulletinAllowanceSigner({ publishSigner: sessionSigner() }),
        ).rejects.toThrow(ENV_HINT);

        expect(ensureSlotAccountSignerMock).not.toHaveBeenCalled();
        expect(requestResourceAllocationMock).not.toHaveBeenCalled();
    });

    it("returns the cached slot signer when authorization is usable", async () => {
        createSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        checkAuthorizationMock.mockResolvedValue({
            authorized: true,
            remainingTransactions: 1,
            remainingBytes: 100n,
            expiration: 1,
        });

        const signer = await getCachedBulletinAllowanceSigner({
            publishSigner: sessionSigner(),
            bulletinApi: {} as any,
            requiredBytes: 50,
        });

        expect(signer).toBe(SLOT_SIGNER);
        expect(ensureSlotAccountSignerMock).not.toHaveBeenCalled();
        expect(requestResourceAllocationMock).not.toHaveBeenCalled();
    });

    it("throws the quota error without requesting an Increase", async () => {
        createSlotAccountSignerMock.mockResolvedValue(SLOT_SIGNER);
        checkAuthorizationMock.mockResolvedValue({
            authorized: true,
            remainingTransactions: 0,
            remainingBytes: 100n,
            expiration: 1,
        });

        await expect(
            getCachedBulletinAllowanceSigner({
                publishSigner: sessionSigner(),
                bulletinApi: {} as any,
                requiredBytes: 50,
            }),
        ).rejects.toThrow(/does not have enough quota/);

        expect(ensureSlotAccountSignerMock).not.toHaveBeenCalled();
        expect(requestResourceAllocationMock).not.toHaveBeenCalled();
    });
});

describe("cachedBulletinSlotAuthorization", () => {
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
