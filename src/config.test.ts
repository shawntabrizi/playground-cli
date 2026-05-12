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

import { describe, expect, it } from "vitest";
import type { CdmJson } from "@parity/product-sdk-contracts";
import cdmJson from "../cdm.json";
import { ACTIVE_TESTNET_NETWORK, getChainConfig, getNetworkLabel } from "./config.js";
import { defaultCdmTarget } from "./utils/cdmTarget.js";

const cdmTarget = defaultCdmTarget(cdmJson as unknown as CdmJson);

describe("getChainConfig", () => {
    it("selects paseo as the active testnet profile", () => {
        expect(ACTIVE_TESTNET_NETWORK).toBe("paseo");
        expect(getNetworkLabel()).toBe("paseo");
    });

    it("uses the installed CDM target for Asset Hub", () => {
        expect(getChainConfig().assetHubRpc).toBe(cdmTarget["asset-hub"]);
    });

    it("uses Paseo Next v2 chain endpoints for non-CDM services", () => {
        expect(getChainConfig().bulletinRpc).toBe("wss://paseo-bulletin-next-rpc.polkadot.io");
        expect(getChainConfig().peopleEndpoints).toEqual([
            "wss://paseo-people-next-system-rpc.polkadot.io",
        ]);
    });

    it("uses the installed CDM target for the Bulletin gateway", () => {
        const gateway = cdmTarget.bulletin!;
        expect(getChainConfig().bulletinGateway).toBe(
            gateway.endsWith("/") ? gateway : `${gateway}/`,
        );
    });
});
