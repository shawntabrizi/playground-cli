#!/usr/bin/env bun
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
 * One-shot diagnostic: is AutoMapper enabled on paseo-next-v2 Asset Hub Next,
 * and is a given SS58 already mapped?
 *
 * Usage:
 *   bun run tools/diagnose-mapping.ts <ss58_address>
 *
 * Example:
 *   bun run tools/diagnose-mapping.ts 5F4aTLmKgrBRmDtoEhEBdEaXjLagWvjmuvwx5bZMacNRTXbC
 *
 * What it prints:
 *   - Whether the chain exposes the Revive pallet
 *   - The `Revive.AutoMap` runtime constant value (true = AutoMapper enabled)
 *   - The H160 derived from your SS58 via `ReviveApi.address`
 *   - Whether `Revive.OriginalAccount[H160]` is set (= account is mapped)
 *
 * If AutoMap=true AND OriginalAccount returns a value, the on-chain mapping is
 * in place and `dot init`'s storage check should skip the `map_account` tx.
 */

import { createClient } from "polkadot-api";
import { toHex } from "polkadot-api/utils";
import { getWsProvider } from "polkadot-api/ws";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";

const RPC = process.env.RPC ?? "wss://paseo-asset-hub-next-rpc.polkadot.io";
const address = process.argv[2];

if (!address) {
    console.error("usage: bun run tools/diagnose-mapping.ts <ss58_address>");
    process.exit(1);
}

const client = createClient(getWsProvider(RPC));
const api = client.getTypedApi(paseo_asset_hub);

try {
    console.log(`RPC: ${RPC}`);
    console.log(`Address: ${address}\n`);

    // 1. AutoMap constant — `#[pallet::constant]` in pallet_revive exposes this
    //    in metadata, so PAPI surfaces it as `api.constants.Revive.AutoMap()`.
    try {
        const autoMap = await api.constants.Revive.AutoMap();
        console.log(`Revive.AutoMap         : ${autoMap}`);
    } catch (err) {
        console.log(
            `Revive.AutoMap         : (not found — Revive may be absent or constant renamed)`,
        );
        console.log(`  ${(err as Error).message}\n`);
    }

    // 2. Derive H160 from SS58 via the ReviveApi.address runtime call —
    //    same path bulletin-deploy uses (dotns.ts:706).
    let h160: Uint8Array;
    try {
        const raw = await api.apis.ReviveApi.address(address);
        // PAPI may surface SizedHex<20> as a Binary wrapper, hex string, or
        // raw Uint8Array depending on version. Normalise.
        if (typeof raw === "string") {
            h160 = Uint8Array.from(
                (raw.startsWith("0x") ? raw.slice(2) : raw)
                    .match(/.{1,2}/g)!
                    .map((b) => parseInt(b, 16)),
            );
        } else if (raw && typeof (raw as { asBytes?: () => Uint8Array }).asBytes === "function") {
            h160 = (raw as { asBytes: () => Uint8Array }).asBytes();
        } else {
            h160 = raw as Uint8Array;
        }
        console.log(`Derived H160           : ${toHex(h160)}`);
    } catch (err) {
        console.log(`ReviveApi.address      : FAILED — ${(err as Error).message}`);
        process.exit(1);
    }

    // 3. Reverse lookup in Revive.OriginalAccount — non-null iff mapped.
    //    May throw `Incompatible runtime entry` when the bundled descriptor's
    //    type for `OriginalAccount` has drifted from the live runtime; report
    //    that distinctly so the user knows the answer is "indeterminate from
    //    the typed query" rather than "definitely not mapped".
    try {
        const original = await api.query.Revive.OriginalAccount.getValue(h160);
        if (original) {
            console.log(`Revive.OriginalAccount : ${original}`);
            console.log(`\n→ Account IS mapped. \`dot init\` will skip map_account.`);
        } else {
            console.log(`Revive.OriginalAccount : <none>`);
            console.log(`\n→ Account is NOT mapped yet. \`dot init\` will attempt map_account.`);
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`Revive.OriginalAccount : QUERY FAILED — ${msg}`);
        if (msg.includes("Incompatible runtime entry")) {
            console.log(
                `\n→ Mapping status is INDETERMINATE (bundled descriptor is stale vs. live runtime).`,
            );
            console.log(
                `  \`dot init\` will fall through to map_account regardless. Once the descriptor`,
            );
            console.log(`  ships a regenerated paseo-asset-hub, this query will work.`);
        } else {
            console.log(`\n→ Storage query failed for an unexpected reason. Investigate.`);
        }
    }
} finally {
    client.destroy();
}
