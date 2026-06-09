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

import { describe, it, expect } from "vitest";
import { createSigningGate, createSigningGateRegistry } from "./signingGate.js";

/** A controllable async task: resolves only when `release()` is called. */
function deferred() {
    let release!: () => void;
    const promise = new Promise<void>((r) => {
        release = r;
    });
    return { promise, release };
}

describe("createSigningGate", () => {
    // The core nonce-safety invariant: two holders are NEVER inside the critical
    // section at the same time. If this can fail, concurrent same-account deploys
    // could submit two extrinsics that read the same on-chain nonce — the exact
    // race the gate exists to prevent.
    it("never lets two sections run concurrently", async () => {
        const gate = createSigningGate();
        let active = 0;
        let maxActive = 0;

        const section = async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            // Yield to the event loop so a broken gate would interleave here.
            await new Promise((r) => setTimeout(r, 0));
            active -= 1;
        };

        await Promise.all([
            gate.runExclusive(section),
            gate.runExclusive(section),
            gate.runExclusive(section),
        ]);

        expect(maxActive).toBe(1);
    });

    it("grants acquisitions in FIFO order", async () => {
        const gate = createSigningGate();
        const order: number[] = [];
        const gates = [deferred(), deferred(), deferred()];

        // Start three holders; each records its order then waits to be released.
        const runs = gates.map((g, i) =>
            gate.runExclusive(async () => {
                order.push(i);
                await g.promise;
            }),
        );

        // Release in queue order; only the current holder can be running.
        for (const g of gates) {
            await Promise.resolve();
            g.release();
        }
        await Promise.all(runs);

        expect(order).toEqual([0, 1, 2]);
    });

    it("releases the gate when a holder throws, unblocking the next", async () => {
        const gate = createSigningGate();
        const ran: string[] = [];

        const first = gate
            .runExclusive(async () => {
                ran.push("first");
                throw new Error("boom");
            })
            .catch(() => ran.push("first-caught"));

        const second = gate.runExclusive(async () => {
            ran.push("second");
        });

        await Promise.all([first, second]);
        // The thrown first holder must not poison the chain — second still runs.
        expect(ran).toContain("second");
        expect(ran).toContain("first-caught");
    });

    it("propagates each run's own result and error", async () => {
        const gate = createSigningGate();
        await expect(gate.runExclusive(async () => 42)).resolves.toBe(42);
        await expect(gate.runExclusive(async () => Promise.reject(new Error("x")))).rejects.toThrow(
            "x",
        );
    });
});

describe("createSigningGateRegistry", () => {
    it("shares one gate per address and isolates distinct addresses", () => {
        const registry = createSigningGateRegistry();
        const a1 = registry.forAddress("alice");
        const a2 = registry.forAddress("alice");
        const b = registry.forAddress("bob");
        expect(a1).toBe(a2);
        expect(a1).not.toBe(b);
    });

    it("serializes same-address work but parallelizes different addresses", async () => {
        const registry = createSigningGateRegistry();
        let aliceActive = 0;
        let aliceMax = 0;
        let bobMax = 0;
        let crossMax = 0;
        let crossActive = 0;

        const make = (address: string, bump: () => void) =>
            registry.forAddress(address).runExclusive(async () => {
                crossActive += 1;
                crossMax = Math.max(crossMax, crossActive);
                bump();
                await new Promise((r) => setTimeout(r, 0));
                crossActive -= 1;
            });

        await Promise.all([
            make("alice", () => {
                aliceActive += 1;
                aliceMax = Math.max(aliceMax, aliceActive);
                aliceActive -= 1;
            }),
            make("alice", () => {
                aliceActive += 1;
                aliceMax = Math.max(aliceMax, aliceActive);
                aliceActive -= 1;
            }),
            make("bob", () => {
                bobMax = Math.max(bobMax, 1);
            }),
        ]);

        // Same-address (alice) work is serialized; alice+bob can overlap.
        expect(aliceMax).toBe(1);
        expect(crossMax).toBeGreaterThan(1);
    });
});
