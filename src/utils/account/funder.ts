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
 * Testnet funder accounts used to top up users and session keys on Paseo
 * Asset Hub. We try Alice first (public dev account — free tokens while she
 * lasts) and fall back to a dedicated account whose seed is embedded here
 * (obscure, not one of the well-known dev dropdowns in polkadot.js Apps, so
 * random drainers don't target it the way they target Alice).
 *
 * Goes away on mainnet: users fund themselves and this module is retired.
 */

import type { PolkadotSigner } from "polkadot-api";
import { createDevSigner, getDevPublicKey } from "@parity/product-sdk-tx";
import { seedToAccount } from "@parity/product-sdk-keys";
import { ss58Encode } from "@parity/product-sdk-address";

/**
 * Dedicated testnet funder mnemonic. Obscure-by-convention (not in any
 * public dropdown), not a security boundary — anyone with this CLI binary
 * can extract it. Acceptable on testnet; replace for mainnet.
 */
const DEDICATED_FUNDER_MNEMONIC =
    "bargain obey warm sing goose glimpse kind repeat grape orchard reason rely";

const dedicated = seedToAccount(DEDICATED_FUNDER_MNEMONIC, "//0");

export interface Funder {
    /** Log-friendly name — included in `AllFundersExhaustedError.tried`. */
    name: string;
    /** SS58 address used to query the funder's current balance. */
    address: string;
    /** Signer used when this funder is selected for a transfer. */
    signer: PolkadotSigner;
}

/**
 * Ordered chain of funders. Callers walk this list and pick the first funder
 * whose free balance ≥ required amount. Public Alice comes first so the
 * dedicated account only gets drawn down once she's drained.
 */
export const FUNDER_CHAIN: readonly Funder[] = [
    {
        name: "Alice",
        address: ss58Encode(getDevPublicKey("Alice")),
        signer: createDevSigner("Alice"),
    },
    {
        name: "dedicated",
        address: ss58Encode(dedicated.publicKey),
        signer: dedicated.signer,
    },
];

/** Convenience: public address of the dedicated funder. Used by the balance-check CI job. */
export const DEDICATED_FUNDER_ADDRESS = FUNDER_CHAIN[1].address;

/** Base Paseo Asset Hub faucet URL — shown when every funder is drained. */
export const FAUCET_URL = "https://faucet.polkadot.io/?network=pah";

/** Faucet URL pre-filled with the user's address — one click to self-fund. */
export function faucetUrlFor(address: string): string {
    return `${FAUCET_URL}&address=${address}`;
}
