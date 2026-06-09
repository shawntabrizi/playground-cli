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

import type { ApAllocationOutcome } from "@parity/product-sdk-terminal/host";
import { describe, expect, test } from "vitest";
import { PLAYGROUND_RESOURCES, describeResource, summarizeOutcomes } from "./resources.js";

// `ApAllocationOutcome`'s `Allocated.value` is the materialized resource
// payload (not `undefined`), so we build minimal valid literals. Only the
// `tag` matters to `summarizeOutcomes`; the inner payload is never read.
const allocated: ApAllocationOutcome = {
    tag: "Allocated",
    value: { tag: "BulletInAllowance", value: { slotAccountKey: new Uint8Array(32) } },
};
const rejected: ApAllocationOutcome = { tag: "Rejected", value: undefined };
const notAvailable: ApAllocationOutcome = { tag: "NotAvailable", value: undefined };

describe("PLAYGROUND_RESOURCES", () => {
    test("requests only the resources the CLI consumes: Bulletin, SmartContract(0)", () => {
        // StatementStoreAllowance is intentionally absent — the CLI never
        // consumes a product Statement Store slot key (see resources.ts), and
        // requesting it blocked `playground init` for users whose on-chain SSS
        // ring was full (phone returns NotAvailable).
        expect(PLAYGROUND_RESOURCES.map((r) => r.tag)).toEqual([
            "BulletInAllowance",
            "SmartContractAllowance",
        ]);
        const sc = PLAYGROUND_RESOURCES.find((r) => r.tag === "SmartContractAllowance");
        expect(sc?.value).toBe(0);
    });
});

describe("summarizeOutcomes", () => {
    test("buckets outcomes by tag, order-sensitive", () => {
        // Explicit resource list so this stays independent of PLAYGROUND_RESOURCES.
        const resources: typeof PLAYGROUND_RESOURCES = [
            { tag: "BulletInAllowance", value: undefined },
            { tag: "StatementStoreAllowance", value: undefined },
            { tag: "SmartContractAllowance", value: 0 },
        ];
        const summary = summarizeOutcomes([allocated, rejected, notAvailable], resources);
        expect(summary.granted.map((r) => r.tag)).toEqual(["BulletInAllowance"]);
        expect(summary.rejected.map((r) => r.tag)).toEqual(["StatementStoreAllowance"]);
        expect(summary.unavailable.map((r) => r.tag)).toEqual(["SmartContractAllowance"]);
    });

    test("drops outcomes without a matching resource", () => {
        const summary = summarizeOutcomes([allocated, allocated], [PLAYGROUND_RESOURCES[0]]);
        expect(summary.granted).toHaveLength(1);
    });
});

describe("describeResource", () => {
    test("human labels", () => {
        expect(describeResource({ tag: "BulletInAllowance", value: undefined })).toMatch(
            /bulletin/i,
        );
    });
});
