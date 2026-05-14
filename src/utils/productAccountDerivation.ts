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
 * Local sr25519 soft-derivation for the product-account public key.
 *
 * The mobile wallet (polkadot-app-android-v2) derives the product account
 * keypair via substrate-sdk-android with derivation path
 * `"/product/{productId}/{derivationIndex}"`, applied to the user's wallet
 * mnemonic (see `feature_products_impl::ProductAccountDerivationUseCase`).
 *
 * Sr25519 soft derivation is composable on public keys alone, so given the
 * user's bare-mnemonic public key (sent over SSO as `session.rootAccountId`
 * — handshake field `rootUserAccountId`, which is `deriveRootAccount()` on
 * the mobile = the mnemonic's bare keypair with `derivationPath = null`) we
 * can compute the same product-account public key that the mobile derives
 * privately, without needing the seed or a mobile round-trip.
 *
 * The chain-code rule (32 bytes per junction) matches
 * `@polkadot-labs/hdkd-helpers::createChainCode`:
 *   - numeric junction (`+code` not NaN) → SCALE u32 LE, zero-padded
 *   - string junction                    → SCALE string (length-prefixed
 *     compact + UTF-8 bytes), zero-padded
 * Upstream silently `RangeError`s if the encoding exceeds 32 bytes (the
 * `Uint8Array.set` call throws). We instead throw a descriptive error. The
 * paths we care about — `product`, dotNS identifiers, small indices —
 * always fit, so this is informational rather than a real fallback.
 */

import { HDKD } from "@scure/sr25519";
import { str, u32 } from "scale-ts";

/**
 * Build the 32-byte chain code for a single derivation junction.
 *
 * Mirrors `@polkadot-labs/hdkd-helpers/dist/index.js::createChainCode`:
 *   numeric: SCALE u32 LE
 *   string : SCALE compact-length + UTF-8 bytes
 * Either way, the encoding is zero-padded out to 32 bytes.
 */
function createChainCode(code: string): Uint8Array {
    const chainCode = new Uint8Array(32);
    const encoded = Number.isNaN(+code) ? str.enc(code) : u32.enc(+code);
    if (encoded.length > 32) {
        throw new Error(
            `Derivation junction "${code}" encodes to ${encoded.length} bytes — exceeds the 32-byte chain-code slot. Long junctions need a blake2b-256 fallback that this helper does not implement; only short junctions (product, dotNS labels, small indices) are supported.`,
        );
    }
    chainCode.set(encoded);
    return chainCode;
}

/**
 * Soft-derive the product-account public key from the parent (root-account)
 * public key, following the mobile's `"/product/{productId}/{derivationIndex}"`
 * convention.
 *
 * `parentPublicKey` must be the bare wallet-mnemonic keypair's public key
 * (the one with no derivation applied) — i.e. `session.rootAccountId`. Passing
 * `session.remoteAccount.accountId` produces the wrong account: that field
 * carries the wallet's currently-selected substrate account, which may have
 * its own derivation applied that the product path is NOT chained off of.
 */
export function deriveProductAccountPublicKey(
    parentPublicKey: Uint8Array,
    productId: string,
    derivationIndex: number,
): Uint8Array {
    let pubkey = parentPublicKey;
    for (const code of ["product", productId, String(derivationIndex)]) {
        pubkey = HDKD.publicSoft(pubkey, createChainCode(code));
    }
    return pubkey;
}
