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
import { createDevSigner } from "@parity/product-sdk-tx";
import type { ResolvedSigner } from "./signer.js";
import {
    PLAYGROUND_REGISTRY_CONTRACT,
    READ_ONLY_QUERY_ORIGIN,
    suppressReviveTraceNoise,
    withRequiredLiveContractAddresses,
} from "./contractManifest.js";
import { TESTNET_CHAIN_DESCRIPTORS } from "./chainDescriptors.js";

import cdmJson from "../../cdm.json";

async function livePlaygroundRegistryManifest(
    rawClient: Parameters<typeof ContractManager.fromClient>[1],
): Promise<CdmJson> {
    let manifest: CdmJson;
    try {
        manifest = await withRequiredLiveContractAddresses(cdmJson, rawClient, [
            PLAYGROUND_REGISTRY_CONTRACT,
        ]);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
            `MetaRegistryFailure: Could not resolve the live Playground registry contract address from the CDM meta-registry. Refusing to use the cdm.json snapshot because it may be stale. ${msg}`,
            { cause: err instanceof Error ? err : undefined },
        );
    }
    return manifest;
}

/**
 * Get a typed handle for read-only Playground registry calls.
 *
 * Registry browsing and metadata lookup do not need, and should not depend on,
 * the user's product account. Use a stable read-only origin so `dot mod` works
 * before the product account has Asset Hub funding/mapping.
 */
export async function getReadOnlyRegistryContract(
    rawClient: Parameters<typeof ContractManager.fromClient>[1],
) {
    const manifest = await livePlaygroundRegistryManifest(rawClient);
    const manager = await ContractManager.fromClient(
        manifest,
        rawClient,
        TESTNET_CHAIN_DESCRIPTORS.assetHub,
        {
            defaultSigner: createDevSigner("Alice"),
            defaultOrigin: READ_ONLY_QUERY_ORIGIN,
        },
    );
    return suppressReviveTraceNoise(manager.getContract(PLAYGROUND_REGISTRY_CONTRACT));
}

/**
 * Get a typed handle for signed Playground registry calls.
 */
export async function getRegistryContract(
    rawClient: Parameters<typeof ContractManager.fromClient>[1],
    signer: ResolvedSigner,
) {
    const manifest = await livePlaygroundRegistryManifest(rawClient);
    const manager = await ContractManager.fromClient(
        manifest,
        rawClient,
        TESTNET_CHAIN_DESCRIPTORS.assetHub,
        {
            defaultSigner: signer.signer,
            defaultOrigin: signer.address,
        },
    );
    return suppressReviveTraceNoise(manager.getContract(PLAYGROUND_REGISTRY_CONTRACT));
}
