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
 * Revive account mapping — SS58 ↔ H160.
 *
 * On paseo-next-v2 the asset-hub runtime wires `pallet_revive::AutoMapper` into
 * `frame_system::OnNewAccount` (see polkadot-sdk
 * `substrate/frame/revive/src/address.rs::AutoMapper`), so any account that
 * has had a consumer-ref bumped — first balance transfer, first Revive call,
 * etc. — is auto-mapped via `AddressMapper::map_no_deposit` without ever
 * needing an explicit `Revive.map_account` extrinsic.
 *
 * We still check via storage before attempting to map, so that:
 *   - Accounts already mapped by AutoMapper short-circuit without signing a
 *     redundant tx (the explicit `map_account` is what was throwing BadProof
 *     under the AsPgas extension surface on early runs).
 *   - The fallback `ensureMapped` call is only reached for the rare case where
 *     no on-chain side-effect has yet triggered AutoMapper.
 */

import { createInkSdk } from "@polkadot-api/sdk-ink";
import { ensureAccountMapped } from "@parity/product-sdk-tx";
import type { PolkadotSigner } from "polkadot-api";
import type { PaseoClient } from "../connection.js";

/**
 * Returns true iff `address` (SS58) is mapped in Revive.
 *
 * Mirrors `bulletin-deploy/src/dotns.ts::checkIfAccountMapped`: derive the
 * H160 via the `ReviveApi.address` runtime call (canonical
 * `AddressMapper::to_address(account_id)` on the chain side), then query
 * `Revive.OriginalAccount[H160]` — non-null iff the H160 has an associated
 * SS58 binding stored.
 *
 * The storage query can throw `Incompatible runtime entry Storage(Revive.OriginalAccount)`
 * when our bundled `@parity/product-sdk-descriptors/paseo-asset-hub` type
 * info for `OriginalAccount` has drifted from the live runtime. We swallow it
 * to "not mapped" rather than crashing init — the fallback `ensureMapped`
 * path will handle the no-op case correctly if the account turns out to be
 * already mapped (the chain rejects the redundant `map_account` extrinsic,
 * which our error surface displays clearly). Drop the swallow once
 * `@parity/product-sdk-descriptors` ships a regenerated `paseo-asset-hub`
 * descriptor that matches the live runtime.
 */
export async function checkMapping(client: PaseoClient, address: string): Promise<boolean> {
    try {
        const evmAddress = await client.assetHub.apis.ReviveApi.address(address);
        const original = await client.assetHub.query.Revive.OriginalAccount.getValue(evmAddress);
        return original !== null && original !== undefined;
    } catch (err) {
        if (process.env.DOT_DEPLOY_VERBOSE === "1") {
            // eslint-disable-next-line no-console
            console.error(
                `[checkMapping] swallowed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        return false;
    }
}

/**
 * Submit `Revive.map_account` from the user's signer. Should not normally be
 * needed on paseo-next-v2 — AutoMapper handles it implicitly on the first
 * consumer-ref bump. Kept as a fallback for the cold-start case where no
 * prior on-chain activity has touched the user's account.
 *
 * Catches known-benign rejections that effectively mean "the account is
 * already mapped" so the init flow doesn't surface a scary error on a
 * second run:
 *
 *   - `InvalidTransaction::Stale` — the chain saw a tx with this nonce
 *     already. On an `AutoMap=true` chain `map_account` is a dispatch-side
 *     no-op, so the only way the chain processes the second submission is
 *     to reject it at validate_transaction time, and Stale is the typical
 *     shape (CheckNonce returns stale when `tx.nonce <= account.nonce`).
 *   - `AccountAlreadyMapped` — explicit Revive dispatch error from
 *     non-AutoMap chains. Self-explanatory.
 *
 * If our `checkMapping` storage probe could read the live runtime cleanly
 * we'd never enter this path twice — but the bundled
 * `@parity/product-sdk-descriptors/paseo-asset-hub` is currently stale vs.
 * the live `wss://paseo-asset-hub-next-rpc.polkadot.io` runtime, so storage
 * decodes fail and `checkMapping` returns a false negative. This catch is
 * the safety net until the descriptor catches up.
 */
export async function ensureMapped(
    client: PaseoClient,
    address: string,
    signer: PolkadotSigner,
): Promise<void> {
    const inkSdk = createInkSdk(client.raw.assetHub, { atBest: true });
    try {
        await ensureAccountMapped(address, signer, inkSdk, client.assetHub);
    } catch (err) {
        if (isBenignMappingError(err)) {
            return;
        }
        throw err;
    }
}

function isBenignMappingError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    // PAPI's tx-invalid rejection JSON shape — `{"type":"Invalid","value":{"type":"Stale"}}`.
    if (/"type"\s*:\s*"Stale"/i.test(msg)) return true;
    if (/InvalidTransaction.*Stale|Stale.*InvalidTransaction/i.test(msg)) return true;
    // Pre-AutoMap dispatch error from explicit map_account on an already-mapped account.
    if (/AccountAlreadyMapped/i.test(msg)) return true;
    return false;
}
