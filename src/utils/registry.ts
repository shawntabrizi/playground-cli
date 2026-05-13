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
import { ss58Encode } from "@parity/product-sdk-address";
import { getDevPublicKey } from "@parity/product-sdk-tx";
import type { ResolvedSigner } from "./signer.js";
import {
    PLAYGROUND_REGISTRY_CONTRACT,
    suppressReviveTraceNoise,
    withRequiredLiveContractAddresses,
} from "./contractManifest.js";

import cdmJson from "../../cdm.json";

/**
 * Stable origin used for read-only registry queries (`dot mod` and friends).
 * Derived from Alice's dev pubkey so it stays consistent across runs without
 * dragging the user's product account into the call. Revive query nodes
 * accept any SS58 as origin for read-only dry-runs.
 */
const READ_ONLY_QUERY_ORIGIN = ss58Encode(getDevPublicKey("Alice"));

async function loadManifest(
    rawClient: Parameters<typeof ContractManager.fromClient>[1],
    origin: string,
): Promise<CdmJson> {
    try {
        return await withRequiredLiveContractAddresses(
            cdmJson,
            rawClient,
            [PLAYGROUND_REGISTRY_CONTRACT],
            { defaultOrigin: origin },
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
            `MetaRegistryFailure: Could not resolve the live Playground registry contract address from the CDM meta-registry. Refusing to use the cdm.json snapshot because it may be stale. ${msg}`,
            { cause: err instanceof Error ? err : undefined },
        );
    }
}

/**
 * Get a typed handle to the playground registry contract for SIGNED writes
 * (e.g. `registry.publish.tx(...)`). Caller is responsible for providing a
 * funded + mapped user signer.
 */
export async function getRegistryContract(
    rawClient: Parameters<typeof ContractManager.fromClient>[1],
    signer: ResolvedSigner,
) {
    const manifest = await loadManifest(rawClient, signer.address);
    const manager = await ContractManager.fromClient(manifest, rawClient, {
        defaultSigner: signer.signer,
        defaultOrigin: signer.address,
    });
    return suppressReviveTraceNoise(manager.getContract(PLAYGROUND_REGISTRY_CONTRACT));
}

/**
 * Get a read-only handle to the registry contract. No signer required; reads
 * use `READ_ONLY_QUERY_ORIGIN` as the dry-run origin. Use this from any path
 * that only calls `.query()` methods (e.g. `dot mod` listing moddable apps),
 * so the command doesn't need the user to be logged in / mapped first.
 *
 * Do NOT call `.tx()` on the returned contract — there is no signer wired in,
 * and `defaultOrigin` is Alice, so any submission would either crash or be
 * misattributed.
 */
export async function getReadOnlyRegistryContract(
    rawClient: Parameters<typeof ContractManager.fromClient>[1],
) {
    const manifest = await loadManifest(rawClient, READ_ONLY_QUERY_ORIGIN);
    const manager = await ContractManager.fromClient(manifest, rawClient, {
        defaultOrigin: READ_ONLY_QUERY_ORIGIN,
    });
    return suppressReviveTraceNoise(manager.getContract(PLAYGROUND_REGISTRY_CONTRACT));
}
