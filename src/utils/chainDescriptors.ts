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

import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { paseo_bulletin } from "@parity/product-sdk-descriptors/paseo-bulletin";
import { paseo_individuality } from "@parity/product-sdk-descriptors/paseo-individuality";
import { previewnet_asset_hub } from "@parity/product-sdk-descriptors/previewnet-asset-hub";
import { previewnet_bulletin } from "@parity/product-sdk-descriptors/previewnet-bulletin";
import { previewnet_individuality } from "@parity/product-sdk-descriptors/previewnet-individuality";
import { ACTIVE_TESTNET_NETWORK, type TestnetNetwork } from "../config.js";

const TESTNET_DESCRIPTORS = {
    "preview-net": {
        assetHub: previewnet_asset_hub,
        bulletin: previewnet_bulletin,
        individuality: previewnet_individuality,
    },
    paseo: {
        assetHub: paseo_asset_hub,
        bulletin: paseo_bulletin,
        individuality: paseo_individuality,
    },
} as const satisfies Record<
    TestnetNetwork,
    {
        assetHub: typeof previewnet_asset_hub | typeof paseo_asset_hub;
        bulletin: typeof previewnet_bulletin | typeof paseo_bulletin;
        individuality: typeof previewnet_individuality | typeof paseo_individuality;
    }
>;

export const TESTNET_CHAIN_DESCRIPTORS = TESTNET_DESCRIPTORS[ACTIVE_TESTNET_NETWORK];

export type TestnetChainDescriptors = typeof TESTNET_CHAIN_DESCRIPTORS;
