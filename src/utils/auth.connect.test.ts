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
 * Regression coverage for the `connect()` adapter lifecycle.
 *
 * `connect()` creates a TerminalAdapter to probe for an existing session.
 * On the existing-session path it returns plain address data — the adapter
 * is not part of the result, so `connect()` itself is the only place that
 * can release it. Forgetting the destroy leaks a live statement-store
 * WebSocket + subscriptions for the rest of the process lifetime; that
 * leaked machinery is exactly the kind that can enter the polkadot-api
 * microtask-flood state (see `process-guard.ts`) and grow a zombie process
 * to tens of GB. `getSessionSigner()` and `findSession()` already destroy
 * their probe adapters on early-return paths — this pins `connect()` to the
 * same contract.
 *
 * Lives in its own file (not `auth.test.ts`) because it module-mocks
 * `@parity/product-sdk-terminal`, and the sibling suite exercises the real
 * exports.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTerminalAdapterMock, waitForSessionsMock } = vi.hoisted(() => ({
    createTerminalAdapterMock: vi.fn(),
    waitForSessionsMock: vi.fn(),
}));

vi.mock("@parity/product-sdk-terminal", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@parity/product-sdk-terminal")>();
    return {
        ...actual,
        createTerminalAdapter: createTerminalAdapterMock,
        waitForSessions: waitForSessionsMock,
    };
});

import { connect } from "./auth.js";

// A valid ristretto255 point — same frozen vector as `auth.test.ts`'s
// deriveSessionAddresses block. `connect()` derives display addresses from
// the session root, and arbitrary 32-byte buffers won't decode.
const TEST_ROOT_BYTES = Uint8Array.from([
    0x9a, 0x76, 0x3d, 0x8d, 0x7d, 0xb9, 0x5e, 0xbd, 0xeb, 0x8f, 0xe2, 0x60, 0xb8, 0x90, 0xf3, 0x5a,
    0x25, 0x3d, 0xb8, 0x27, 0x74, 0xf6, 0x34, 0x46, 0x6c, 0xed, 0x38, 0x7a, 0xa1, 0x4e, 0xfd, 0x29,
]);

function fakeAdapter() {
    return {
        destroy: vi.fn().mockResolvedValue(undefined),
        sso: {
            authenticate: vi.fn(() => new Promise(() => {})),
            pairingStatus: { subscribe: vi.fn(() => () => {}) },
        },
    };
}

describe("connect() adapter lifecycle", () => {
    beforeEach(() => {
        createTerminalAdapterMock.mockReset();
        waitForSessionsMock.mockReset();
    });

    it("destroys the probe adapter on the existing-session path", async () => {
        const adapter = fakeAdapter();
        createTerminalAdapterMock.mockReturnValue(adapter);
        waitForSessionsMock.mockResolvedValue([{ rootAccountId: TEST_ROOT_BYTES }]);

        const result = await connect();

        expect(result.kind).toBe("existing");
        // The adapter is not part of the "existing" result, so connect()
        // must release it itself — a leak here keeps the statement-store
        // WebSocket (and the event loop) alive for the whole process.
        expect(adapter.destroy).toHaveBeenCalledTimes(1);
    });

    it("destroys the adapter when the session probe throws", async () => {
        const adapter = fakeAdapter();
        createTerminalAdapterMock.mockReturnValue(adapter);
        waitForSessionsMock.mockRejectedValue(new Error("statement store unreachable"));

        await expect(connect()).rejects.toThrow("statement store unreachable");
        expect(adapter.destroy).toHaveBeenCalledTimes(1);
    });

    it("keeps the adapter alive on the QR path and hands it to the caller", async () => {
        const adapter = fakeAdapter();
        createTerminalAdapterMock.mockReturnValue(adapter);
        waitForSessionsMock.mockResolvedValue([]);
        adapter.sso.pairingStatus.subscribe.mockImplementation(
            (cb: (status: { step: string; payload: string }) => void) => {
                cb({ step: "pairing", payload: "pairing-payload" });
                return () => {};
            },
        );

        const result = await connect();

        expect(result.kind).toBe("qr");
        // QR path: the login flow still needs the adapter (authenticate()
        // is in flight) — ownership transfers to the caller via LoginHandle.
        expect(adapter.destroy).not.toHaveBeenCalled();
        if (result.kind === "qr") {
            expect(result.login.adapter).toBe(adapter);
        }
    });
});
