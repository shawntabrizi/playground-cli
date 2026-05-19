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

import { describe, expect, it, vi } from "vitest";
import {
    PLAYGROUND_RESOURCES,
    requestResourceAllocation,
    summarizeOutcomes,
    type AllocatableResource,
    type AllocationOutcome,
} from "./host.js";

describe("PLAYGROUND_RESOURCES", () => {
    it("requests mobile-granted StatementStore + SmartContract resources by default", () => {
        const tags = PLAYGROUND_RESOURCES.map((r) => r.tag);
        expect(tags).not.toContain("BulletInAllowance");
        expect(tags).toContain("StatementStoreAllowance");
        expect(tags).toContain("SmartContractAllowance");
    });

    it("uses derivation index 0 for the SmartContractAllowance (default product account)", () => {
        const smartContract = PLAYGROUND_RESOURCES.find((r) => r.tag === "SmartContractAllowance");
        expect(smartContract).toBeDefined();
        expect(smartContract?.value).toBe(0);
    });
});

describe("summarizeOutcomes", () => {
    const resources: AllocatableResource[] = [
        { tag: "BulletInAllowance", value: undefined },
        { tag: "StatementStoreAllowance", value: undefined },
        { tag: "SmartContractAllowance", value: 0 },
    ];

    it("buckets all three outcome shapes", () => {
        const outcomes: AllocationOutcome[] = [
            {
                tag: "Allocated",
                value: { tag: "BulletInAllowance", value: { slotAccountKey: new Uint8Array() } },
            },
            { tag: "Rejected", value: undefined },
            { tag: "NotAvailable", value: undefined },
        ];
        const { granted, rejected, unavailable } = summarizeOutcomes(outcomes, resources);
        expect(granted.map((r) => r.tag)).toEqual(["BulletInAllowance"]);
        expect(rejected.map((r) => r.tag)).toEqual(["StatementStoreAllowance"]);
        expect(unavailable.map((r) => r.tag)).toEqual(["SmartContractAllowance"]);
    });

    it("drops outcomes that have no matching resource (defensive against host mis-ordered responses)", () => {
        const outcomes: AllocationOutcome[] = [
            {
                tag: "Allocated",
                value: { tag: "BulletInAllowance", value: { slotAccountKey: new Uint8Array() } },
            },
            { tag: "Rejected", value: undefined },
            { tag: "NotAvailable", value: undefined },
            {
                tag: "Allocated",
                value: {
                    tag: "AutoSigning",
                    value: { productDerivationSecret: "", productRootPrivateKey: new Uint8Array() },
                },
            },
        ];
        const summary = summarizeOutcomes(outcomes, resources);
        expect(summary.granted.length + summary.rejected.length + summary.unavailable.length).toBe(
            3,
        );
    });

    it("returns empty buckets when there are no outcomes", () => {
        const summary = summarizeOutcomes([], []);
        expect(summary.granted).toEqual([]);
        expect(summary.rejected).toEqual([]);
        expect(summary.unavailable).toEqual([]);
    });
});

describe("requestResourceAllocation", () => {
    it("forwards `callingProductId`, `resources`, and `onExisting: 'Ignore'` to the session", async () => {
        const calls: unknown[] = [];
        const fakeSession = {
            requestResourceAllocation: vi.fn(async (req: unknown) => {
                calls.push(req);
                return {
                    isErr: () => false,
                    value: [
                        {
                            tag: "Allocated",
                            value: {
                                tag: "BulletInAllowance",
                                value: { slotAccountKey: new Uint8Array() },
                            },
                        },
                    ],
                };
            }),
        } as unknown as Parameters<typeof requestResourceAllocation>[0];

        const outcomes = await requestResourceAllocation(fakeSession, "playground42.dot", [
            { tag: "BulletInAllowance", value: undefined },
        ]);

        expect(calls).toEqual([
            {
                callingProductId: "playground42.dot",
                resources: [{ tag: "BulletInAllowance", value: undefined }],
                onExisting: "Ignore",
            },
        ]);
        expect(outcomes[0].tag).toBe("Allocated");
    });

    it("throws a wrapped error when the session returns an error result", async () => {
        const fakeSession = {
            requestResourceAllocation: vi.fn(async () => ({
                isErr: () => true,
                error: new Error("statement store unreachable"),
            })),
        } as unknown as Parameters<typeof requestResourceAllocation>[0];

        await expect(
            requestResourceAllocation(fakeSession, "playground42.dot", []),
        ).rejects.toThrow(/statement store unreachable/);
    });

    it("uses PLAYGROUND_RESOURCES when no explicit list is supplied", async () => {
        let captured: { resources?: unknown } = {};
        const fakeSession = {
            requestResourceAllocation: vi.fn(async (req: { resources: unknown }) => {
                captured = req;
                return { isErr: () => false, value: [] };
            }),
        } as unknown as Parameters<typeof requestResourceAllocation>[0];

        await requestResourceAllocation(fakeSession, "playground42.dot");
        expect(captured.resources).toEqual(PLAYGROUND_RESOURCES);
    });
});
