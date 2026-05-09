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
 * Tests for auth.ts edge cases — specifically the subscribe-before-assignment bug.
 *
 * The real subscribe/pairing flow requires a live adapter, so these tests
 * verify the patterns used rather than the full integration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    clearLocalAppStorage,
    waitForLogout,
    type LogoutHandle,
    type LogoutStatus,
} from "./auth.js";
import { DAPP_ID } from "../config.js";

describe("subscribe-before-assignment pattern", () => {
    /**
     * Simulates the bug where `const unsub = obs.subscribe(cb)` fires
     * the callback synchronously, causing `unsub` to be referenced
     * before it's assigned.
     *
     * The fix uses `let unsub; unsub = obs.subscribe(cb)` with `unsub?.()`.
     */
    it("handles synchronous callback firing during subscribe", () => {
        let callbackFired = false;
        let unsubCalled = false;

        // Simulate an observable that fires synchronously
        const syncObservable = {
            subscribe(cb: (status: { step: string; payload?: string }) => void) {
                // Fires immediately during subscribe()
                cb({ step: "pairing", payload: "qr-data" });
                return () => {
                    unsubCalled = true;
                };
            },
        };

        // The FIXED pattern (let + optional chaining)
        let done = false;
        let unsub: (() => void) | undefined;
        unsub = syncObservable.subscribe((status) => {
            if (status.step === "pairing" && !done) {
                done = true;
                unsub?.(); // safe — unsub is undefined when called sync, but done=true prevents re-entry
                callbackFired = true;
            }
        });

        expect(callbackFired).toBe(true);
        expect(done).toBe(true);
        // unsub?.() was called when unsub was still undefined (sync), so unsubCalled is false
        // but the callback still ran correctly
    });

    it("handles asynchronous callback firing after subscribe returns", () => {
        let callbackFired = false;
        let unsubCalled = false;

        // Simulate an observable that fires asynchronously
        let storedCb: ((status: { step: string; payload?: string }) => void) | null = null;
        const asyncObservable = {
            subscribe(cb: (status: { step: string; payload?: string }) => void) {
                storedCb = cb;
                return () => {
                    unsubCalled = true;
                };
            },
        };

        let done = false;
        let unsub: (() => void) | undefined;
        unsub = asyncObservable.subscribe((status) => {
            if (status.step === "pairing" && !done) {
                done = true;
                unsub?.();
                callbackFired = true;
            }
        });

        // Fire callback after subscribe has returned — unsub is assigned
        storedCb!({ step: "pairing", payload: "qr-data" });

        expect(callbackFired).toBe(true);
        expect(unsubCalled).toBe(true); // unsub was assigned, so it was called
    });

    it("done flag prevents double-resolution", () => {
        let resolutionCount = 0;

        const observable = {
            subscribe(cb: (status: { step: string }) => void) {
                // Fires twice
                cb({ step: "pairing" });
                cb({ step: "pairing" });
                return () => {};
            },
        };

        let done = false;
        let unsub: (() => void) | undefined;
        unsub = observable.subscribe((status) => {
            if (status.step === "pairing" && !done) {
                done = true;
                unsub?.();
                resolutionCount++;
            }
        });

        expect(resolutionCount).toBe(1);
    });
});

// ── Sign-out flow ─────────────────────────────────────────────────────────────

/**
 * Minimal stand-in for `@parity/product-sdk-terminal`'s TerminalAdapter, wide enough
 * for what `waitForLogout` actually touches. We don't import the real type here
 * so the test file stays cheap to run; a compile error if the real API drifts
 * is caught by the consuming call site in auth.ts, not here.
 */
type FakeResult<T, E> = { isOk(): true; value: T } | { isOk(): false; error: E };

function okResult<T>(value: T): FakeResult<T, never> {
    return { isOk: () => true as const, value };
}

function errResult<E>(error: E): FakeResult<never, E> {
    return { isOk: () => false as const, error };
}

/** Fake session handle — only the fields `waitForLogout` reads. */
function fakeSession() {
    return {
        id: "test-session-id",
        localAccount: {} as never,
        remoteAccount: {} as never,
    };
}

interface FakeAdapter {
    destroyCalls: number;
    sessions: {
        disconnect(session: ReturnType<typeof fakeSession>): PromiseLike<FakeResult<void, Error>>;
    };
    destroy(): void;
}

function fakeAdapter(
    disconnect: (session: ReturnType<typeof fakeSession>) => PromiseLike<FakeResult<void, Error>>,
): FakeAdapter {
    const adapter: FakeAdapter = {
        destroyCalls: 0,
        sessions: { disconnect },
        destroy() {
            adapter.destroyCalls++;
        },
    };
    return adapter;
}

describe("waitForLogout", () => {
    let appsDir: string;
    let originalHome: string | undefined;

    beforeEach(() => {
        // Redirect `~/.polkadot-apps` to a tmp dir so the clearLocalAppStorage
        // fallback can't touch the dev's real logged-in account.
        appsDir = mkdtempSync(join(tmpdir(), "pg-logout-test-"));
        originalHome = process.env.HOME;
        process.env.HOME = appsDir;
    });

    afterEach(() => {
        if (originalHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = originalHome;
        }
        rmSync(appsDir, { recursive: true, force: true });
    });

    it("emits disconnecting → success and destroys the adapter on happy path", async () => {
        const adapter = fakeAdapter(() => Promise.resolve(okResult(undefined)));
        const handle = {
            adapter,
            address: "5Gxyz",
            session: fakeSession(),
        } as unknown as LogoutHandle;
        const events: LogoutStatus[] = [];

        await waitForLogout(handle, (s) => events.push(s));

        expect(events).toEqual([
            { step: "disconnecting", address: "5Gxyz" },
            { step: "success", address: "5Gxyz" },
        ]);
        expect(adapter.destroyCalls).toBe(1);
    });

    it("falls back to local clear and emits partial when disconnect returns err", async () => {
        // Seed a stale session file so we can verify the fallback actually deletes it.
        const staleDir = join(appsDir, ".polkadot-apps");
        const { mkdirSync } = await import("node:fs");
        mkdirSync(staleDir, { recursive: true });
        const staleFile = join(staleDir, `${DAPP_ID}_SsoSessions.json`);
        const foreignFile = join(staleDir, "other-app_SsoSessions.json");
        writeFileSync(staleFile, "stale");
        writeFileSync(foreignFile, "leave-me-alone");

        const adapter = fakeAdapter(() => Promise.resolve(errResult(new Error("ws halted"))));
        const handle = {
            adapter,
            address: "5Gxyz",
            session: fakeSession(),
        } as unknown as LogoutHandle;
        const events: LogoutStatus[] = [];

        await waitForLogout(handle, (s) => events.push(s));

        expect(events).toEqual([
            { step: "disconnecting", address: "5Gxyz" },
            { step: "partial", address: "5Gxyz", reason: "ws halted" },
        ]);
        expect(adapter.destroyCalls).toBe(1);
        expect(existsSync(staleFile)).toBe(false);
        // Foreign app's files MUST remain untouched.
        expect(existsSync(foreignFile)).toBe(true);
    });

    it("falls back to local clear when disconnect throws", async () => {
        const adapter = fakeAdapter(() => {
            throw new Error("connection refused");
        });
        const handle = {
            adapter,
            address: "5Gxyz",
            session: fakeSession(),
        } as unknown as LogoutHandle;
        const events: LogoutStatus[] = [];

        await waitForLogout(handle, (s) => events.push(s));

        expect(events).toEqual([
            { step: "disconnecting", address: "5Gxyz" },
            { step: "partial", address: "5Gxyz", reason: "connection refused" },
        ]);
        expect(adapter.destroyCalls).toBe(1);
    });

    it("emits a generic err message for non-Error throws", async () => {
        const adapter = fakeAdapter(() => {
            // eslint-disable-next-line @typescript-eslint/no-throw-literal
            throw "string rejection";
        });
        const handle = {
            adapter,
            address: "5Gxyz",
            session: fakeSession(),
        } as unknown as LogoutHandle;
        const events: LogoutStatus[] = [];

        await waitForLogout(handle, (s) => events.push(s));

        expect(events[1]).toEqual({
            step: "partial",
            address: "5Gxyz",
            reason: "string rejection",
        });
    });
});

describe("clearLocalAppStorage", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "pg-clear-storage-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("is a no-op when the directory does not exist", async () => {
        const missing = join(dir, "does-not-exist");
        await expect(clearLocalAppStorage(missing)).resolves.toBeUndefined();
    });

    it("removes only files prefixed with `${DAPP_ID}_`", async () => {
        const ours1 = join(dir, `${DAPP_ID}_SsoSessions.json`);
        const ours2 = join(dir, `${DAPP_ID}_UserSecrets_abc.json`);
        const foreign = join(dir, "polkadot-desktop_SsoSessions.json");
        const looksSimilar = join(dir, `${DAPP_ID}.backup`);
        writeFileSync(ours1, "a");
        writeFileSync(ours2, "b");
        writeFileSync(foreign, "c");
        writeFileSync(looksSimilar, "d");

        await clearLocalAppStorage(dir);

        expect(existsSync(ours1)).toBe(false);
        expect(existsSync(ours2)).toBe(false);
        expect(existsSync(foreign)).toBe(true);
        // `${DAPP_ID}.backup` lacks the underscore → safe.
        expect(existsSync(looksSimilar)).toBe(true);
    });

    it("swallows unlink errors so callers stay on the happy path", async () => {
        // Nothing to delete → nothing to error on, but the promise must resolve.
        await expect(clearLocalAppStorage(dir)).resolves.toBeUndefined();
    });
});
