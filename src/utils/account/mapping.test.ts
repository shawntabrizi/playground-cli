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
 * `mapping.ts` itself is thin (delegates to `createInkSdk` + `ensureAccountMapped`
 * from `@parity/product-sdk-tx`, both already tested upstream). The thing that
 * matters for us is the wrapper's branching and argument plumbing:
 *
 *   - `checkMapping` reflects `addressIsMapped`
 *   - `ensureMapped` always calls `ensureAccountMapped` (the upstream helper
 *     is itself documented idempotent, so we don't short-circuit here)
 *   - errors from either path propagate unchanged so the UI can surface them
 */

import { describe, it, expect, vi } from "vitest";

const mockAddressIsMapped = vi.fn<() => Promise<boolean>>();
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

function makeClient() {
    return {
        raw: { assetHub: { __raw: true } },
        assetHub: { __typed: true },
    } as any; // PaseoClient shape, but we only need .raw.assetHub + .assetHub
}

function makeSigner() {
    return { __signer: true } as any;
}

describe("checkMapping", () => {
    it("returns true when the address is already mapped", async () => {
        mockCreateInkSdk.mockReturnValue({ addressIsMapped: mockAddressIsMapped });
        mockAddressIsMapped.mockResolvedValue(true);

        const client = makeClient();
        const result = await checkMapping(client, "5GrwvaEF...");

        expect(result).toBe(true);
        expect(mockCreateInkSdk).toHaveBeenCalledWith(client.raw.assetHub, { atBest: true });
        expect(mockAddressIsMapped).toHaveBeenCalledWith("5GrwvaEF...");
    });

    it("returns false when not mapped", async () => {
        mockCreateInkSdk.mockReturnValue({ addressIsMapped: mockAddressIsMapped });
        mockAddressIsMapped.mockResolvedValue(false);

        const result = await checkMapping(makeClient(), "5Fxxx...");
        expect(result).toBe(false);
    });

    it("propagates RPC errors so the UI can show them", async () => {
        mockCreateInkSdk.mockReturnValue({ addressIsMapped: mockAddressIsMapped });
        mockAddressIsMapped.mockRejectedValue(new Error("connection reset"));

        await expect(checkMapping(makeClient(), "5F...")).rejects.toThrow("connection reset");
    });
});

describe("ensureMapped", () => {
    it("forwards client, signer, and sdk into ensureAccountMapped", async () => {
        mockCreateInkSdk.mockClear();
        mockEnsureAccountMapped.mockClear();

        const fakeSdk = { addressIsMapped: vi.fn().mockResolvedValue(false) };
        mockCreateInkSdk.mockReturnValue(fakeSdk);
        mockEnsureAccountMapped.mockResolvedValue(undefined);

        const client = makeClient();
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

        await expect(ensureMapped(makeClient(), "5F...", makeSigner())).rejects.toThrow(
            /Mobile signing rejected/,
        );
    });
});
