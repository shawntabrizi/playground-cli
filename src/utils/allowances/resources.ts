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
 * CLI-local glue around `@parity/product-sdk-terminal/host`'s RFC-0010 types.
 * The wire call, slot-key caching (`~/.polkadot-apps/<appId>_AllowanceKeys.json`)
 * and slot signers all live in the SDK now — the only things kept here are the
 * playground's resource set and pure display helpers.
 */

import type { AllocatableResource, ApAllocationOutcome } from "@parity/product-sdk-terminal/host";

/**
 * The full mobile-granted resource set for the playground product:
 * Bulletin storage, Statement Store, and PGAS sponsoring for Revive
 * contract calls (derivation index 0 = the default playground account).
 * All three are requested in ONE `requestResourceAllocation` call so the
 * user sees a single approval dialog during `playground init`.
 */
export const PLAYGROUND_RESOURCES: AllocatableResource[] = [
    { tag: "BulletInAllowance", value: undefined },
    { tag: "StatementStoreAllowance", value: undefined },
    { tag: "SmartContractAllowance", value: 0 },
];

export interface AllocationSummary {
    granted: AllocatableResource[];
    rejected: AllocatableResource[];
    unavailable: AllocatableResource[];
}

/**
 * Bucket allocation outcomes by tag. Order-sensitive: `outcomes[i]` maps to
 * `resources[i]`. Outcomes without a matching resource are silently dropped.
 */
export function summarizeOutcomes(
    outcomes: ApAllocationOutcome[],
    resources: AllocatableResource[],
): AllocationSummary {
    const granted: AllocatableResource[] = [];
    const rejected: AllocatableResource[] = [];
    const unavailable: AllocatableResource[] = [];
    outcomes.forEach((outcome, i) => {
        const resource = resources[i];
        if (!resource) return;
        if (outcome.tag === "Allocated") granted.push(resource);
        else if (outcome.tag === "Rejected") rejected.push(resource);
        else unavailable.push(resource);
    });
    return { granted, rejected, unavailable };
}

/** Human-readable name for a resource tag, used in failure messages. */
export function describeResource(resource: AllocatableResource): string {
    switch (resource.tag) {
        case "BulletInAllowance":
            return "Bulletin storage";
        case "StatementStoreAllowance":
            return "Statement Store";
        case "SmartContractAllowance":
            return `smart-contract gas (idx ${resource.value})`;
        case "AutoSigning":
            return "auto-signing";
    }
}
