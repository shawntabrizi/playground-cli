import { describe, it, expect } from "vitest";
import { createSigningCounter } from "./signingProxy.js";

describe("createSigningCounter", () => {
    it("returns sequential step numbers against the configured total", () => {
        const c = createSigningCounter(3);
        expect(c.next()).toEqual({ step: 1, total: 3 });
        expect(c.next()).toEqual({ step: 2, total: 3 });
        expect(c.next()).toEqual({ step: 3, total: 3 });
        expect(c.count()).toBe(3);
    });

    it("clamps total upward when step exceeds the predicted count", () => {
        // Regression: TUI used to print "approve step 5 of 4" whenever
        // bulletin-deploy fired an extra `setUserPopStatus` tx that the
        // predicted plan missed. Clamping the total up to the current step
        // keeps the display coherent even when the prediction under-shoots.
        const c = createSigningCounter(2);
        expect(c.next()).toEqual({ step: 1, total: 2 });
        expect(c.next()).toEqual({ step: 2, total: 2 });
        // Predicted 2 taps, but a third fires:
        expect(c.next()).toEqual({ step: 3, total: 3 });
        // And a fourth:
        expect(c.next()).toEqual({ step: 4, total: 4 });
    });

    it("count() reflects every reserved step regardless of clamping", () => {
        const c = createSigningCounter(1);
        c.next();
        c.next();
        c.next();
        expect(c.count()).toBe(3);
    });
});
