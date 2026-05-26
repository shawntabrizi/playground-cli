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
import {
    describeUsernameValidationError,
    formatUsernameLine,
    validateUsernameClient,
    type UsernameLookup,
    type UsernameValidationError,
} from "./username.js";

const ZERO_H160 = "0x0000000000000000000000000000000000000000" as `0x${string}`;

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

// Mocks for `lookupRegistryUsername` / `isRegistryUsernameAvailable` /
// `setRegistryUsername`. We don't reuse the `lookupUsername` mocks because
// that function uses its own polkadot-api client; the registry-facing helpers
// all go through the shared `getConnection()` and the read-only / signed
// registry contracts.
const mockGetConnection = vi.fn();
const mockGetReadOnlyRegistryContract = vi.fn();
const mockGetRegistryContract = vi.fn();

vi.mock("./connection.js", () => ({
    getConnection: () => mockGetConnection(),
}));

vi.mock("./registry.js", () => ({
    getReadOnlyRegistryContract: (rawClient: unknown) => mockGetReadOnlyRegistryContract(rawClient),
    getRegistryContract: (rawClient: unknown, signer: unknown) =>
        mockGetRegistryContract(rawClient, signer),
}));

describe("lookupRegistryUsername", () => {
    beforeEach(() => {
        vi.resetModules();
        mockGetConnection.mockReset();
        mockGetReadOnlyRegistryContract.mockReset();

        // Default: a connection whose raw.assetHub is just a sentinel object —
        // we never touch it directly, only forward it to the contract factory.
        mockGetConnection.mockResolvedValue({ raw: { assetHub: { _sentinel: "assetHub" } } });
    });

    // Regression guard for the v7-deploy degradation path. The CLI ships against
    // the latest manifest but a target chain may still be running an older
    // contract that has no `getUsername` method — the SDK returns a registry
    // handle whose `.getUsername` is undefined. We must NOT throw; the row falls
    // through to the People-parachain name.
    it("returns null when the registry has no getUsername method (older contract)", async () => {
        mockGetReadOnlyRegistryContract.mockResolvedValue({}); // no getUsername key at all
        const { lookupRegistryUsername } = await import("./username.js");
        await expect(lookupRegistryUsername(ZERO_H160)).resolves.toBeNull();
    });

    it("returns null when getUsername exists but .query is undefined", async () => {
        mockGetReadOnlyRegistryContract.mockResolvedValue({ getUsername: {} });
        const { lookupRegistryUsername } = await import("./username.js");
        await expect(lookupRegistryUsername(ZERO_H160)).resolves.toBeNull();
    });

    it("returns null when the query result is success=false", async () => {
        mockGetReadOnlyRegistryContract.mockResolvedValue({
            getUsername: {
                query: vi.fn().mockResolvedValue({ success: false, value: "ignored" }),
            },
        });
        const { lookupRegistryUsername } = await import("./username.js");
        await expect(lookupRegistryUsername(ZERO_H160)).resolves.toBeNull();
    });

    it("returns null when the returned value is the empty-string sentinel", async () => {
        mockGetReadOnlyRegistryContract.mockResolvedValue({
            getUsername: {
                query: vi.fn().mockResolvedValue({ success: true, value: "" }),
            },
        });
        const { lookupRegistryUsername } = await import("./username.js");
        await expect(lookupRegistryUsername(ZERO_H160)).resolves.toBeNull();
    });

    it("returns the username on a successful query", async () => {
        const queryFn = vi.fn().mockResolvedValue({ success: true, value: "alice" });
        mockGetReadOnlyRegistryContract.mockResolvedValue({ getUsername: { query: queryFn } });
        const h160 = "0xabcdef0123456789abcdef0123456789abcdef01" as `0x${string}`;

        const { lookupRegistryUsername } = await import("./username.js");
        const result = await lookupRegistryUsername(h160);

        expect(result).toBe("alice");
        expect(queryFn).toHaveBeenCalledWith(h160);
    });

    it("swallows thrown errors and returns null (display-time fallback)", async () => {
        mockGetReadOnlyRegistryContract.mockRejectedValue(new Error("rpc went poof"));
        const { lookupRegistryUsername } = await import("./username.js");
        await expect(lookupRegistryUsername(ZERO_H160)).resolves.toBeNull();
    });
});

describe("validateUsernameClient", () => {
    // Each case mirrors a branch of the contract's `validate_username` (see
    // `playground-app/contracts/registry/lib.rs:260`). If the contract bounds
    // ever move, these tests should be the first thing to fail.
    it.each<[string, UsernameValidationError | null]>([
        ["al", "UsernameTooShort"], // 2 chars < MIN 3
        ["a".repeat(31), "UsernameTooLong"], // 31 chars > MAX 30
        ["-alice", "UsernameInvalidEdge"],
        ["alice-", "UsernameInvalidEdge"],
        ["al!ce", "UsernameInvalidChar"], // bang is outside a-z 0-9 -
        ["foo bar", "UsernameInvalidChar"], // space is outside a-z 0-9 -
        ["al--ice", "UsernameDoubleDash"],
        ["alice", null],
        ["alice-bob", null],
        ["abc123", null],
        ["a-1-b-2", null],
    ])("validates %s as %s", (input, expected) => {
        expect(validateUsernameClient(input)).toBe(expected);
    });

    // The contract lowercases server-side; we lowercase client-side so users
    // typing `Alice` see the same a-z rule applied as the chain.
    it("lowercases the input before charset checks", () => {
        expect(validateUsernameClient("ALICE")).toBeNull();
        expect(validateUsernameClient("Alice-Bob")).toBeNull();
    });

    it("describeUsernameValidationError returns user-facing copy for every tag", () => {
        const tags: UsernameValidationError[] = [
            "UsernameTooShort",
            "UsernameTooLong",
            "UsernameInvalidChar",
            "UsernameInvalidEdge",
            "UsernameDoubleDash",
        ];
        for (const tag of tags) {
            const copy = describeUsernameValidationError(tag);
            expect(copy.length).toBeGreaterThan(0);
            // No raw revert tags should leak into the user-facing copy.
            expect(copy).not.toContain("Username");
        }
    });
});

describe("isRegistryUsernameAvailable", () => {
    beforeEach(() => {
        vi.resetModules();
        mockGetConnection.mockReset();
        mockGetReadOnlyRegistryContract.mockReset();
        mockGetConnection.mockResolvedValue({ raw: { assetHub: { _sentinel: "assetHub" } } });
    });

    it("returns null when the contract lacks isUsernameAvailable (older deploy)", async () => {
        mockGetReadOnlyRegistryContract.mockResolvedValue({});
        const { isRegistryUsernameAvailable } = await import("./username.js");
        await expect(isRegistryUsernameAvailable("alice", ZERO_H160)).resolves.toBeNull();
    });

    it("returns null on a non-boolean value (defensive: never assume success.value is bool)", async () => {
        mockGetReadOnlyRegistryContract.mockResolvedValue({
            isUsernameAvailable: {
                query: vi.fn().mockResolvedValue({ success: true, value: "not-a-bool" }),
            },
        });
        const { isRegistryUsernameAvailable } = await import("./username.js");
        await expect(isRegistryUsernameAvailable("alice", ZERO_H160)).resolves.toBeNull();
    });

    it("returns true when the name is available", async () => {
        const queryFn = vi.fn().mockResolvedValue({ success: true, value: true });
        mockGetReadOnlyRegistryContract.mockResolvedValue({
            isUsernameAvailable: { query: queryFn },
        });
        const { isRegistryUsernameAvailable } = await import("./username.js");
        await expect(isRegistryUsernameAvailable("alice", ZERO_H160)).resolves.toBe(true);
        expect(queryFn).toHaveBeenCalledWith("alice", ZERO_H160);
    });

    it("returns false when the name is already taken", async () => {
        mockGetReadOnlyRegistryContract.mockResolvedValue({
            isUsernameAvailable: {
                query: vi.fn().mockResolvedValue({ success: true, value: false }),
            },
        });
        const { isRegistryUsernameAvailable } = await import("./username.js");
        await expect(isRegistryUsernameAvailable("alice", ZERO_H160)).resolves.toBe(false);
    });
});

describe("setRegistryUsername", () => {
    beforeEach(() => {
        vi.resetModules();
        mockGetConnection.mockReset();
        mockGetRegistryContract.mockReset();
        mockGetConnection.mockResolvedValue({ raw: { assetHub: { _sentinel: "assetHub" } } });
    });

    // The signer payload itself isn't introspected by this helper — we just
    // forward it to `getRegistryContract`. A sentinel object keeps the test
    // hermetic without dragging in the real ResolvedSigner shape.
    const FAKE_SIGNER = { signer: { _sentinel: "signer" }, address: "5Gxyz", source: "session" };

    // Defense-in-depth: the UI prompt's own `validate` callback rejects
    // invalid input before reaching here, but the helper is publicly exported
    // and a future caller could skip the prompt. We refuse outright instead
    // of burning a tx that the chain would just revert anyway.
    it("refuses to submit a name that fails client-side validation", async () => {
        const txFn = vi.fn();
        mockGetRegistryContract.mockResolvedValue({ setUsername: { tx: txFn } });

        const { setRegistryUsername } = await import("./username.js");
        await expect(
            setRegistryUsername(
                FAKE_SIGNER as unknown as import("./signer.js").ResolvedSigner,
                "al", // 2 chars < min 3
            ),
        ).rejects.toThrow(/Invalid username "al"/);
        expect(txFn).not.toHaveBeenCalled();
    });

    it("forwards the name + pinned gas/storage opts to setUsername.tx", async () => {
        const txFn = vi.fn().mockResolvedValue({ ok: true });
        mockGetRegistryContract.mockResolvedValue({ setUsername: { tx: txFn } });

        const { setRegistryUsername } = await import("./username.js");
        await setRegistryUsername(
            FAKE_SIGNER as unknown as import("./signer.js").ResolvedSigner,
            "alice",
        );

        expect(txFn).toHaveBeenCalledTimes(1);
        const [name, opts] = txFn.mock.calls[0];
        expect(name).toBe("alice");
        // Regression guard: if these constants ever change in production code
        // it should be a deliberate update — `setUsername` is known to land
        // OutOfGas without these pinned values on first-time storage inserts.
        expect(opts.gasLimit).toEqual({ ref_time: 1_500_000_000_000n, proof_size: 2_000_000n });
        expect(opts.storageDepositLimit).toBe(1_000_000_000_000n);
    });

    it("throws a helpful error when the contract lacks setUsername (older deploy)", async () => {
        mockGetRegistryContract.mockResolvedValue({});
        const { setRegistryUsername } = await import("./username.js");
        await expect(
            setRegistryUsername(
                FAKE_SIGNER as unknown as import("./signer.js").ResolvedSigner,
                "alice",
            ),
        ).rejects.toThrow(/setUsername is not available/);
    });

    it("throws when the tx dispatch returns ok=false (reverted)", async () => {
        mockGetRegistryContract.mockResolvedValue({
            setUsername: { tx: vi.fn().mockResolvedValue({ ok: false }) },
        });
        const { setRegistryUsername } = await import("./username.js");
        await expect(
            setRegistryUsername(
                FAKE_SIGNER as unknown as import("./signer.js").ResolvedSigner,
                "alice",
            ),
        ).rejects.toThrow(/reverted/);
    });

    it("propagates the underlying error when the tx itself throws (e.g. signer rejection)", async () => {
        mockGetRegistryContract.mockResolvedValue({
            setUsername: { tx: vi.fn().mockRejectedValue(new Error("rejected by user")) },
        });
        const { setRegistryUsername } = await import("./username.js");
        await expect(
            setRegistryUsername(
                FAKE_SIGNER as unknown as import("./signer.js").ResolvedSigner,
                "alice",
            ),
        ).rejects.toThrow(/rejected by user/);
    });
});
