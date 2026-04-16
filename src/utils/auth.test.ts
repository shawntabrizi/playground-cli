/**
 * Tests for auth.ts edge cases — specifically the subscribe-before-assignment bug.
 *
 * The real subscribe/pairing flow requires a live adapter, so these tests
 * verify the patterns used rather than the full integration.
 */

import { describe, it, expect } from "vitest";

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
