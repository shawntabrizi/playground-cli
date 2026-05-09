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
 * Revive account mapping — check and map SS58 to H160.
 *
 * Required for any EVM contract interaction on Asset Hub.
 * The user's own signer must sign map_account (not Alice).
 */

import { createInkSdk } from "@polkadot-api/sdk-ink";
import { ensureAccountMapped } from "@parity/product-sdk-tx";
import type { PolkadotSigner } from "polkadot-api";
import type { PaseoClient } from "../connection.js";

export async function checkMapping(client: PaseoClient, address: string): Promise<boolean> {
    const inkSdk = createInkSdk(client.raw.assetHub, { atBest: true });
    return inkSdk.addressIsMapped(address);
}

export async function ensureMapped(
    client: PaseoClient,
    address: string,
    signer: PolkadotSigner,
): Promise<void> {
    const inkSdk = createInkSdk(client.raw.assetHub, { atBest: true });
    await ensureAccountMapped(address, signer, inkSdk, client.assetHub);
}
