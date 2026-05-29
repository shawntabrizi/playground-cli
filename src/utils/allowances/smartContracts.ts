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

import { PLAYGROUND_PRODUCT_ID, type Env } from "../../config.js";
import type { ResolvedSigner } from "../signer.js";
import { requestResourceAllocation, summarizeOutcomes, type AllocatableResource } from "./host.js";
import { hasAllowance, markAllowance } from "./marker.js";

const SMART_CONTRACT_ALLOWANCE: AllocatableResource = {
    tag: "SmartContractAllowance",
    value: 0,
};

export interface SmartContractAllowanceOptions {
    env: Env;
    ownerAddress: string;
    deploySigner: ResolvedSigner;
}

export async function ensureSmartContractAllowance({
    env,
    ownerAddress,
    deploySigner,
}: SmartContractAllowanceOptions): Promise<void> {
    if (deploySigner.source === "dev") return;

    if (await hasAllowance(env, ownerAddress, "SmartContractAllowance")) return;

    if (!deploySigner.userSession) {
        throw new Error(
            'No smart-contract gas allowance cached. Run "playground init" to grant allowances.',
        );
    }

    const outcomes = await requestResourceAllocation(
        deploySigner.userSession,
        PLAYGROUND_PRODUCT_ID,
        [SMART_CONTRACT_ALLOWANCE],
    );
    const summary = summarizeOutcomes(outcomes, [SMART_CONTRACT_ALLOWANCE]);

    if (summary.granted.some((resource) => resource.tag === "SmartContractAllowance")) {
        await markAllowance(env, ownerAddress, "SmartContractAllowance", "host");
        return;
    }

    const outcome = outcomes[0]?.tag ?? "returned no outcome";
    throw new Error(
        `Smart-contract gas allowance allocation ${outcome}. Re-run \`playground init\` and approve on your phone.`,
    );
}
