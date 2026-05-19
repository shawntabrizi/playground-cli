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
import { formatUsernameLine, type UsernameLookup } from "./username.js";

describe("formatUsernameLine", () => {
    it("returns the full username when present", () => {
        const lookup: UsernameLookup = {
            kind: "found",
            fullUsername: "alice.dot",
            liteUsername: "alice",
        };
        expect(formatUsernameLine(lookup)).toBe("alice.dot");
    });

    it("falls back to the lite username when full is null", () => {
        const lookup: UsernameLookup = {
            kind: "found",
            fullUsername: null,
            liteUsername: "alice",
        };
        expect(formatUsernameLine(lookup)).toBe("alice");
    });

    it("returns '(no username set on chain)' when the account has no identity", () => {
        const lookup: UsernameLookup = { kind: "none" };
        expect(formatUsernameLine(lookup)).toBe("(no username set on chain)");
    });

    it("returns '(lookup failed)' on any lookup error", () => {
        const lookup: UsernameLookup = {
            kind: "error",
            reason: "endpoint unreachable",
        };
        expect(formatUsernameLine(lookup)).toBe("(lookup failed)");
    });

    it("returns '(looking up...)' while the lookup is pending", () => {
        const lookup: UsernameLookup = { kind: "loading" };
        expect(formatUsernameLine(lookup)).toBe("(looking up...)");
    });
});

// Mocks must be set up at module-load time so the polkadot-api imports inside
// `username.ts` resolve to our stubs. The pattern mirrors `connection.test.ts`.
const mockGetValues = vi.fn();
const mockCreateClient = vi.fn();
const mockGetWsProvider = vi.fn();
const mockDestroy = vi.fn();

vi.mock("polkadot-api", () => ({
    createClient: (provider: unknown) => mockCreateClient(provider),
}));

vi.mock("polkadot-api/ws", () => ({
    getWsProvider: (endpoints: unknown) => mockGetWsProvider(endpoints),
}));

describe("lookupUsername", () => {
    beforeEach(() => {
        vi.resetModules();
        mockGetValues.mockReset();
        mockCreateClient.mockReset();
        mockGetWsProvider.mockReset();
        mockDestroy.mockReset();

        mockGetWsProvider.mockImplementation(() => ({}));
        mockCreateClient.mockImplementation(() => ({
            destroy: mockDestroy,
            getUnsafeApi: () => ({
                query: {
                    Resources: {
                        Consumers: {
                            getValues: mockGetValues,
                        },
                    },
                },
            }),
        }));
    });

    // Regression guard: under scale-ts's `fromHex`-based string decoder,
    // routing the SS58 through `AccountId().dec(...)` silently corrupts it
    // (most SS58 chars aren't in `HEX_MAP`) and the storage call surfaces as
    // `(lookup failed)`. The whole bug class disappears as long as we pass
    // the SS58 string through unchanged — this test fails if anyone
    // reintroduces a codec round-trip.
    it("passes the SS58 string directly to getValues, with no codec round-trip", async () => {
        const ss58 = "5GGpUaN7XNaUp3nEVDPBSR4SQLxFxQsiPHbFwf69Apr3HgDZ";
        mockGetValues.mockResolvedValue([null]);

        const { lookupUsername } = await import("./username.js");
        const result = await lookupUsername(ss58);

        expect(mockGetValues).toHaveBeenCalledTimes(1);
        expect(mockGetValues).toHaveBeenCalledWith([[ss58]]);
        expect(result).toEqual({ kind: "none" });
    });

    it("returns 'found' with decoded usernames when the chain has a record", async () => {
        const fullUsername = new TextEncoder().encode("alice.dot");
        const liteUsername = new TextEncoder().encode("alice");
        mockGetValues.mockResolvedValue([
            { full_username: fullUsername, lite_username: liteUsername, credibility: null },
        ]);

        const { lookupUsername } = await import("./username.js");
        const result = await lookupUsername("5GGpUaN7XNaUp3nEVDPBSR4SQLxFxQsiPHbFwf69Apr3HgDZ");

        expect(result).toEqual({
            kind: "found",
            fullUsername: "alice.dot",
            liteUsername: "alice",
        });
    });

    it("returns 'error' if the Resources.Consumers storage entry is missing from chain metadata", async () => {
        mockCreateClient.mockImplementation(() => ({
            destroy: mockDestroy,
            getUnsafeApi: () => ({
                query: { Resources: undefined },
            }),
        }));

        const { lookupUsername } = await import("./username.js");
        const result = await lookupUsername("5GGpUaN7XNaUp3nEVDPBSR4SQLxFxQsiPHbFwf69Apr3HgDZ");

        expect(result.kind).toBe("error");
    });

    it("destroys the per-call client to release the WebSocket", async () => {
        mockGetValues.mockResolvedValue([null]);
        const { lookupUsername } = await import("./username.js");
        await lookupUsername("5GGpUaN7XNaUp3nEVDPBSR4SQLxFxQsiPHbFwf69Apr3HgDZ");
        expect(mockDestroy).toHaveBeenCalledTimes(1);
    });
});
