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
