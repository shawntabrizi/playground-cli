/**
 * Tests for the init-completion predicate.
 *
 * We import the real `computeAllDone` from `./completion.js` — exactly the
 * function the component consumes — so any drift in the predicate is caught
 * here instead of silently passing because the test has its own copy.
 */

import { describe, it, expect } from "vitest";
import { computeAllDone } from "./completion.js";

describe("computeAllDone", () => {
    it("does not complete while deps are still running", () => {
        expect(
            computeAllDone({
                needsQr: false,
                authResolved: true,
                loggedInAddress: null,
                depsComplete: false,
                accountComplete: false,
            }),
        ).toBe(false);
    });

    it("completes after deps when --yes is passed (no auth)", () => {
        expect(
            computeAllDone({
                needsQr: false,
                authResolved: true,
                loggedInAddress: null,
                depsComplete: true,
                accountComplete: false,
            }),
        ).toBe(true);
    });

    it("does NOT complete while QR login is in progress even if deps are done", () => {
        expect(
            computeAllDone({
                needsQr: true,
                authResolved: false,
                loggedInAddress: null,
                depsComplete: true,
                accountComplete: false,
            }),
        ).toBe(false);
    });

    it("completes after QR login fails (authResolved but no address)", () => {
        expect(
            computeAllDone({
                needsQr: true,
                authResolved: true,
                loggedInAddress: null,
                depsComplete: true,
                accountComplete: false,
            }),
        ).toBe(true);
    });

    it("does NOT complete after QR login succeeds until account setup finishes", () => {
        expect(
            computeAllDone({
                needsQr: true,
                authResolved: true,
                loggedInAddress: "5Gxyz...",
                depsComplete: true,
                accountComplete: false,
            }),
        ).toBe(false);
    });

    it("completes after QR login + account setup both finish", () => {
        expect(
            computeAllDone({
                needsQr: true,
                authResolved: true,
                loggedInAddress: "5Gxyz...",
                depsComplete: true,
                accountComplete: true,
            }),
        ).toBe(true);
    });

    it("completes with existing session after account setup finishes", () => {
        expect(
            computeAllDone({
                needsQr: false,
                authResolved: true,
                loggedInAddress: "5Gxyz...",
                depsComplete: true,
                accountComplete: true,
            }),
        ).toBe(true);
    });

    it("does NOT complete with existing session until account setup finishes", () => {
        expect(
            computeAllDone({
                needsQr: false,
                authResolved: true,
                loggedInAddress: "5Gxyz...",
                depsComplete: true,
                accountComplete: false,
            }),
        ).toBe(false);
    });
});
