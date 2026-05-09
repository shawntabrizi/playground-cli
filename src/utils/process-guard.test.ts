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

import { describe, expect, it } from "vitest";
import { isBenignUnsubscriptionError, setProcessGuardWarningHandler } from "./process-guard.js";

// Construct an object shaped like rxjs's `UnsubscriptionError` — rxjs builds
// it via `createErrorClass`, so in practice all we rely on is (a) `name ===
// "UnsubscriptionError"` and (b) an `errors` array. Mirror that here rather
// than import rxjs (the CLI doesn't depend on it directly; bulletin-deploy
// does, transitively).
function makeUnsubscriptionError(innerMessages: string[]): Error {
    const err = new Error(
        `${innerMessages.length} errors occurred during unsubscription:\n${innerMessages
            .map((m, i) => `${i + 1}) Error: ${m}`)
            .join("\n  ")}`,
    );
    err.name = "UnsubscriptionError";
    (err as Error & { errors: unknown[] }).errors = innerMessages.map((m) => new Error(m));
    return err;
}

describe("isBenignUnsubscriptionError", () => {
    it("matches a single-error Not connected UnsubscriptionError (the dotns.disconnect() case)", () => {
        expect(isBenignUnsubscriptionError(makeUnsubscriptionError(["Not connected"]))).toBe(true);
    });

    it("matches multi-error payloads where every inner error is Not connected", () => {
        expect(
            isBenignUnsubscriptionError(
                makeUnsubscriptionError(["Not connected", "Not connected"]),
            ),
        ).toBe(true);
    });

    it("is case-insensitive on the inner message", () => {
        expect(isBenignUnsubscriptionError(makeUnsubscriptionError(["NOT CONNECTED"]))).toBe(true);
    });

    it("rejects UnsubscriptionError with at least one non-Not-connected inner error", () => {
        // A real RPC error mixed in means something genuinely went wrong mid
        // teardown — don't swallow it.
        expect(
            isBenignUnsubscriptionError(makeUnsubscriptionError(["Not connected", "ECONNREFUSED"])),
        ).toBe(false);
    });

    it("rejects UnsubscriptionError with an empty errors array", () => {
        // Empty array has no signal of what went wrong — don't assume benign.
        const err = new Error("empty");
        err.name = "UnsubscriptionError";
        (err as Error & { errors: unknown[] }).errors = [];
        expect(isBenignUnsubscriptionError(err)).toBe(false);
    });

    it("rejects non-UnsubscriptionError errors with Not connected message", () => {
        // A bare `Error("Not connected")` is usually a real network failure
        // from an active request path, not the teardown-race we're filtering.
        const err = new Error("Not connected");
        expect(isBenignUnsubscriptionError(err)).toBe(false);
    });

    it("rejects non-Error inputs", () => {
        expect(isBenignUnsubscriptionError(null)).toBe(false);
        expect(isBenignUnsubscriptionError(undefined)).toBe(false);
        expect(isBenignUnsubscriptionError("Not connected")).toBe(false);
        expect(isBenignUnsubscriptionError({ name: "UnsubscriptionError" })).toBe(false);
    });

    it("does NOT suppress DestroyedError — the upstream 0.2.0 fix removed the race", () => {
        // Pre-0.2.0 `@parity/product-sdk-terminal`'s `destroy()` could surface
        // `DestroyedError: Client destroyed` from PAPI's raw-client `disconnect`
        // when statement-subscription unsubscribes were still in flight. We
        // briefly suppressed it. The 0.2.0 fix drains those unsubscribes
        // before tearing down the lazy client, so the shape should never
        // resurface — if it does, it's a real regression and must escalate.
        const err = new Error("Client destroyed");
        err.name = "DestroyedError";
        expect(isBenignUnsubscriptionError(err)).toBe(false);
    });

    it("accepts string entries inside the errors array (rxjs permits them)", () => {
        const err = new Error("x");
        err.name = "UnsubscriptionError";
        (err as Error & { errors: unknown[] }).errors = ["Not connected"];
        expect(isBenignUnsubscriptionError(err)).toBe(true);
    });
});

describe("process guard warning handler", () => {
    it("swallows warning handler failures", () => {
        setProcessGuardWarningHandler(() => {
            throw new Error("telemetry failed");
        });
        expect(() => setProcessGuardWarningHandler(undefined)).not.toThrow();
    });
});
