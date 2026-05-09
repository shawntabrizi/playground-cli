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
 * Playground registry contract access.
 */

import { ContractManager, type CdmJson } from "@parity/product-sdk-contracts";
import type { ResolvedSigner } from "./signer.js";
import {
    PLAYGROUND_REGISTRY_CONTRACT,
    suppressReviveTraceNoise,
    withRequiredLiveContractAddresses,
} from "./contractManifest.js";

import cdmJson from "../../cdm.json";

/**
 * Get a typed handle to the playground registry contract.
 */
export async function getRegistryContract(
    rawClient: Parameters<typeof ContractManager.fromClient>[1],
    signer: ResolvedSigner,
) {
    let manifest: CdmJson;
    try {
        manifest = await withRequiredLiveContractAddresses(
            cdmJson,
            rawClient,
            [PLAYGROUND_REGISTRY_CONTRACT],
            { defaultOrigin: signer.address },
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
            `MetaRegistryFailure: Could not resolve the live Playground registry contract address from the CDM meta-registry. Refusing to use the cdm.json snapshot because it may be stale. ${msg}`,
            { cause: err instanceof Error ? err : undefined },
        );
    }

    const manager = await ContractManager.fromClient(manifest, rawClient, {
        defaultSigner: signer.signer,
        defaultOrigin: signer.address,
    });
    return suppressReviveTraceNoise(manager.getContract(PLAYGROUND_REGISTRY_CONTRACT));
}
