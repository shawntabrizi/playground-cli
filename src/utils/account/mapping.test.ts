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
 * Tests for the Revive-mapping wrapper.
 *
 * `checkMapping` mirrors bulletin-deploy's canonical pattern: derive the H160
 * via `ReviveApi.address`, then query `Revive.OriginalAccount[H160]` —
 * non-null iff the binding exists.
 *
 * RPC failures resolve to `false` (treated as "not mapped" so the caller can
 * fall back to `ensureMapped` rather than surfacing an opaque error to the
 * user during init).
 */

import { describe, it, expect, vi } from "vitest";

const mockEnsureAccountMapped =
    vi.fn<(address: string, signer: unknown, sdk: unknown, client: unknown) => Promise<unknown>>();
const mockCreateInkSdk = vi.fn();

vi.mock("@polkadot-api/sdk-ink", () => ({
    createInkSdk: (...args: unknown[]) => mockCreateInkSdk(...args),
}));

vi.mock("@parity/product-sdk-tx", () => ({
    ensureAccountMapped: (...args: unknown[]) =>
        mockEnsureAccountMapped(...(args as [string, unknown, unknown, unknown])),
}));

const { checkMapping, ensureMapped } = await import("./mapping.js");

const FAKE_H160 = new Uint8Array(20);

function makeClient(opts: {
    address: Uint8Array | (() => Promise<Uint8Array>) | (() => Promise<never>);
    original: string | null | (() => Promise<string | null>) | (() => Promise<never>);
}) {
    const addressApi = typeof opts.address === "function" ? opts.address : async () => opts.address;
    const originalApi =
        typeof opts.original === "function" ? opts.original : async () => opts.original;
    return {
        raw: { assetHub: { __raw: true } },
        assetHub: {
            apis: {
                ReviveApi: {
                    address: vi.fn(addressApi),
                },
            },
            query: {
                Revive: {
                    OriginalAccount: {
                        getValue: vi.fn(originalApi),
                    },
                },
            },
        },
    } as any;
}

function makeSigner() {
    return { __signer: true } as any;
}

describe("checkMapping", () => {
    it("returns true when Revive.OriginalAccount has a binding for the derived H160", async () => {
        const client = makeClient({ address: FAKE_H160, original: "5Galice…" });
        const result = await checkMapping(client, "5GrwvaEF...");

        expect(result).toBe(true);
        expect(client.assetHub.apis.ReviveApi.address).toHaveBeenCalledWith("5GrwvaEF...");
        expect(client.assetHub.query.Revive.OriginalAccount.getValue).toHaveBeenCalledWith(
            FAKE_H160,
        );
    });

    it("returns false when Revive.OriginalAccount returns null", async () => {
        const client = makeClient({ address: FAKE_H160, original: null });
        const result = await checkMapping(client, "5Fxxx...");
        expect(result).toBe(false);
    });

    it("treats OriginalAccount RPC errors as 'not mapped' so init can fall through to map_account", async () => {
        const client = makeClient({
            address: FAKE_H160,
            original: async () => {
                throw new Error("connection reset");
            },
        });
        await expect(checkMapping(client, "5F...")).resolves.toBe(false);
    });

    it("returns false if ReviveApi.address itself fails", async () => {
        const client = makeClient({
            address: async () => {
                throw new Error("runtime api unavailable");
            },
            original: null,
        });
        await expect(checkMapping(client, "5F...")).resolves.toBe(false);
    });
});

describe("ensureMapped", () => {
    it("forwards client, signer, and sdk into ensureAccountMapped", async () => {
        mockCreateInkSdk.mockClear();
        mockEnsureAccountMapped.mockClear();

        const fakeSdk = { addressIsMapped: vi.fn().mockResolvedValue(false) };
        mockCreateInkSdk.mockReturnValue(fakeSdk);
        mockEnsureAccountMapped.mockResolvedValue(undefined);

        const client = makeClient({ address: FAKE_H160, original: null });
        const signer = makeSigner();
        await ensureMapped(client, "5FAlice...", signer);

        expect(mockEnsureAccountMapped).toHaveBeenCalledTimes(1);
        const callArgs = mockEnsureAccountMapped.mock.calls[0];
        expect(callArgs[0]).toBe("5FAlice...");
        expect(callArgs[1]).toBe(signer);
        expect(callArgs[2]).toBe(fakeSdk);
        expect(callArgs[3]).toBe(client.assetHub);
    });

    it("bubbles up signing errors (e.g. user rejected on phone)", async () => {
        mockCreateInkSdk.mockReturnValue({ addressIsMapped: vi.fn() });
        mockEnsureAccountMapped.mockRejectedValue(
            new Error("Mobile signing rejected: user rejected"),
        );

        await expect(
            ensureMapped(makeClient({ address: FAKE_H160, original: null }), "5F...", makeSigner()),
        ).rejects.toThrow(/Mobile signing rejected/);
    });
});
