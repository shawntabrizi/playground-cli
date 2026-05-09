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
 * Tests for unified signer resolution.
 *
 * Mock boundaries:
 *   - `@parity/product-sdk-tx` (createDevSigner, getDevPublicKey)
 *   - `@parity/product-sdk-address` (ss58Encode)
 *   - `./auth.js` (getSessionSigner)
 *
 * We exercise the resolution priority (suri → session → error),
 * SURI parsing edge cases, and the ResolvedSigner contract.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreateDevSigner = vi.fn().mockReturnValue({ __signer: "dev" });
const mockGetDevPublicKey = vi.fn().mockReturnValue(new Uint8Array(32));
const mockSs58Encode = vi.fn().mockReturnValue("5GrwvaEF...");
const mockGetSessionSigner = vi.fn<() => Promise<unknown>>();

vi.mock("@parity/product-sdk-tx", () => ({
    createDevSigner: (...args: unknown[]) => mockCreateDevSigner(...args),
    getDevPublicKey: (...args: unknown[]) => mockGetDevPublicKey(...args),
}));

vi.mock("@parity/product-sdk-address", () => ({
    ss58Encode: (...args: unknown[]) => mockSs58Encode(...args),
}));

vi.mock("./auth.js", () => ({
    getSessionSigner: () => mockGetSessionSigner(),
}));

const { resolveSigner, parseDevAccountName, SignerNotAvailableError } = await import("./signer.js");

beforeEach(() => {
    vi.clearAllMocks();
});

// ── parseDevAccountName ─────────────────────────────────────────────────────

describe("parseDevAccountName", () => {
    it("parses //Alice → Alice", () => {
        expect(parseDevAccountName("//Alice")).toBe("Alice");
    });

    it("parses //Bob without the prefix", () => {
        expect(parseDevAccountName("Bob")).toBe("Bob");
    });

    it("is case-insensitive", () => {
        expect(parseDevAccountName("//alice")).toBe("Alice");
        expect(parseDevAccountName("//FERDIE")).toBe("Ferdie");
    });

    it("returns null for unknown names", () => {
        expect(parseDevAccountName("//Mallory")).toBeNull();
        expect(parseDevAccountName("")).toBeNull();
    });

    it("recognizes all six dev accounts", () => {
        for (const name of ["Alice", "Bob", "Charlie", "Dave", "Eve", "Ferdie"]) {
            expect(parseDevAccountName(`//${name}`)).toBe(name);
        }
    });
});

// ── resolveSigner ───────────────────────────────────────────────────────────

describe("resolveSigner", () => {
    it("resolves dev signer from --suri //Alice", async () => {
        const result = await resolveSigner({ suri: "//Alice" });

        expect(result.source).toBe("dev");
        expect(result.address).toBe("5GrwvaEF...");
        expect(mockCreateDevSigner).toHaveBeenCalledWith("Alice");
        expect(mockGetDevPublicKey).toHaveBeenCalledWith("Alice");
    });

    it("dev signer destroy() is a no-op", async () => {
        const result = await resolveSigner({ suri: "//Alice" });
        expect(() => result.destroy()).not.toThrow();
    });

    it("is case-insensitive for SURI names", async () => {
        await resolveSigner({ suri: "//bob" });
        expect(mockCreateDevSigner).toHaveBeenCalledWith("Bob");
    });

    it("throws for unrecognized SURI", async () => {
        await expect(resolveSigner({ suri: "//Mallory" })).rejects.toThrow(/Unrecognized SURI/);
    });

    it("lists supported names in error message", async () => {
        await expect(resolveSigner({ suri: "//Bad" })).rejects.toThrow(/Alice.*Ferdie/);
    });

    it("falls back to session signer when no SURI", async () => {
        const fakeSession = {
            address: "5Session...",
            signer: { __signer: "session" },
            destroy: vi.fn(),
        };
        mockGetSessionSigner.mockResolvedValue(fakeSession);

        const result = await resolveSigner();

        expect(result.source).toBe("session");
        expect(result.address).toBe("5Session...");
        expect(mockCreateDevSigner).not.toHaveBeenCalled();
    });

    it("throws SignerNotAvailableError when no SURI and no session", async () => {
        mockGetSessionSigner.mockResolvedValue(null);

        await expect(resolveSigner()).rejects.toThrow(SignerNotAvailableError);
        await expect(resolveSigner()).rejects.toThrow(/dot init/);
    });

    it("prefers SURI over session even when session exists", async () => {
        mockGetSessionSigner.mockResolvedValue({
            address: "5Session...",
            signer: {},
            destroy: () => {},
        });

        const result = await resolveSigner({ suri: "//Alice" });

        expect(result.source).toBe("dev");
        expect(mockGetSessionSigner).not.toHaveBeenCalled();
    });

    it("passes session destroy through", async () => {
        const destroyFn = vi.fn();
        mockGetSessionSigner.mockResolvedValue({
            address: "5Session...",
            signer: {},
            destroy: destroyFn,
        });

        const result = await resolveSigner();
        result.destroy();

        expect(destroyFn).toHaveBeenCalledTimes(1);
    });
});
