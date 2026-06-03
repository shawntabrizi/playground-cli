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
 * Session-backed `PolkadotSigner` for the playground product account.
 *
 * Thin wrapper over `@parity/product-sdk-terminal@0.3.0`'s
 * `createSessionSignerForAccount`, which routes transaction signing through
 * host-papp's `createTransaction` SSO pair: the paired wallet builds and signs
 * the extrinsic itself, so every signed extension the chain declares (AsPgas,
 * AsRingAlias, AuthorizeValueTransfer, whatever comes next) is forwarded
 * verbatim — no PJS bridge, no relaxed-extension allow-list. `signBytes`
 * keeps the `signRaw({ tag: "Bytes" })` anti-phishing envelope for raw
 * user data.
 *
 * The ONE thing we add on top of the SDK: we always pass the derived
 * product-account public key. The SDK's fallback (`session.remoteAccount
 * .accountId`) is the wallet's currently-selected account, which is NOT the
 * product account that signs on-chain — PAPI stamps `publicKey` into the
 * extrinsic and verifies against it, so omitting it breaks every signature
 * whenever the product account isn't the selected account (i.e. always, for
 * this CLI).
 */

import { deriveProductAccountPublicKey } from "@parity/product-sdk-keys";
import {
    createSessionSignerForAccount,
    type ProductAccountRef,
    type UserSession,
} from "@parity/product-sdk-terminal";
import type { PolkadotSigner } from "polkadot-api";

export type { ProductAccountRef };

export const INCOMPLETE_SESSION_MESSAGE =
    'Stored login session is missing the root account public key. Run "playground logout" and then "playground init" to pair again.';

export function sessionRootPublicKey(session: UserSession): Uint8Array {
    const rootAccountId = (session as { rootAccountId?: Uint8Array }).rootAccountId;
    const publicKey = rootAccountId ? new Uint8Array(rootAccountId) : new Uint8Array();
    if (publicKey.length !== 32) {
        throw new Error(INCOMPLETE_SESSION_MESSAGE);
    }
    return publicKey;
}

/**
 * Soft-derive the product account public key off a wallet root.
 *
 * This is the single source of truth for product-account math in the CLI.
 * Both `createPlaygroundSessionSigner` (which feeds the key to the SDK
 * signer) and `auth.ts::deriveSessionAddresses` (which builds the display
 * triple for `playground init`) go through here so a future change to
 * derivation params can't silently desync the signer from what we print.
 *
 * sr25519 soft derivation is composable on public keys alone, so deriving
 * from `rootAccountId` locally produces the SAME public key the mobile
 * derives privately via `mnemonic + "/product/...{idx}"`. Algorithm
 * parity with mobile/desktop is locked by the frozen vectors in
 * `@parity/product-sdk-keys`'s `product-account.test.ts` and by the
 * `deriveSessionAddresses` block in `src/utils/auth.test.ts`.
 */
export function derivePlaygroundProductPublicKey(
    rootAccountId: Uint8Array,
    ref: Pick<ProductAccountRef, "productId" | "derivationIndex">,
): Uint8Array {
    return deriveProductAccountPublicKey(rootAccountId, ref.productId, ref.derivationIndex);
}

export function createPlaygroundSessionSigner(
    session: UserSession,
    ref: Pick<ProductAccountRef, "productId" | "derivationIndex">,
): PolkadotSigner {
    const publicKey = derivePlaygroundProductPublicKey(sessionRootPublicKey(session), ref);
    return createSessionSignerForAccount(session, { ...ref, publicKey });
}
