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

import { describe, expect, test } from "vitest";
import { ss58Encode } from "@parity/product-sdk-address";
import { seedToAccount } from "@parity/product-sdk-keys";
import type { UserSession } from "@parity/product-sdk-terminal";
import { PLAYGROUND_PRODUCT_ID } from "../config.js";
import {
    INCOMPLETE_SESSION_MESSAGE,
    createPlaygroundSessionSigner,
    derivePlaygroundProductPublicKey,
} from "./sessionSigner.js";

const DEV_PHRASE = "bottom drive obey lake curtain smoke basket hold race lonely fit walk";

// Stand-in for the mobile's SSO handshake response. `rootAccountId` is
// `deriveRootAccount()` on the mobile = the bare-mnemonic keypair pubkey.
// `remoteAccount.accountId` is the wallet's currently-selected substrate
// account (`walletAccount.defaultAccountId()` on Android) — distinct from the
// product account, and the wrong key for `signer.publicKey`. Only those two
// fields are read by `createPlaygroundSessionSigner`.
function fakeSession(opts: { rootAccountId?: Uint8Array; remoteAccountId?: Uint8Array }) {
    return {
        rootAccountId: opts.rootAccountId,
        remoteAccount: { accountId: opts.remoteAccountId ?? new Uint8Array(32).fill(7) },
    } as unknown as UserSession;
}

describe("createPlaygroundSessionSigner", () => {
    const root = seedToAccount(DEV_PHRASE, "");

    // ────────────────────────────────────────────────────────────────────────
    // Init / deploy / playground-app equivalence
    //
    // Every flow that references "the user's account" must resolve to the same
    // SS58 — the product account derived at `mnemonic + "/product/{id}/0"`.
    //   - `playground init` displays `ss58Encode(signer.publicKey)`.
    //   - `playground deploy --signer phone` passes the same SS58 to
    //     bulletin-deploy as `signerAddress`.
    //   - The deployed playground-app's `HostProvider.getProductAccount`
    //     asks the mobile to compute `seedToAccount(mnemonic, "/product/{id}/0")`.
    // As long as all three pin the same `(rootPubKey, productId, 0)` triple they
    // yield byte-identical SS58 strings. This is the regression guard.
    // ────────────────────────────────────────────────────────────────────────
    test("init signer address === deploy signer address === playground-app address", () => {
        const session = fakeSession({ rootAccountId: root.publicKey });

        const cliSigner = createPlaygroundSessionSigner(session, {
            productId: PLAYGROUND_PRODUCT_ID,
            derivationIndex: 0,
        });
        const cliAddress = ss58Encode(cliSigner.publicKey);

        // What the deployed playground-app gets back from the mobile (mobile
        // computes this exact derivation from the same mnemonic).
        const mobileDerived = seedToAccount(DEV_PHRASE, `/product/${PLAYGROUND_PRODUCT_ID}/0`);
        const playgroundAppAddress = ss58Encode(mobileDerived.publicKey);

        expect(cliAddress).toEqual(playgroundAppAddress);
    });

    test("signer.publicKey is the derived product account, not the wallet account", () => {
        const session = fakeSession({
            rootAccountId: root.publicKey,
            remoteAccountId: new Uint8Array(32).fill(7),
        });
        const signer = createPlaygroundSessionSigner(session, {
            productId: PLAYGROUND_PRODUCT_ID,
            derivationIndex: 0,
        });
        const expected = derivePlaygroundProductPublicKey(root.publicKey, {
            productId: PLAYGROUND_PRODUCT_ID,
            derivationIndex: 0,
        });

        // The pre-fix bug set signer.publicKey from session.remoteAccount.accountId
        // (the user's wallet account), not the product-derived account. The chain
        // would see the wallet as From — different from the funded / allowance-
        // granted product account. This guard ensures we never slip back.
        expect(signer.publicKey).toEqual(expected);
        expect(ss58Encode(signer.publicKey)).not.toEqual(ss58Encode(new Uint8Array(32).fill(7)));
    });

    test("throws the friendly message when rootAccountId is missing", () => {
        const session = fakeSession({ rootAccountId: undefined });
        expect(() =>
            createPlaygroundSessionSigner(session, {
                productId: PLAYGROUND_PRODUCT_ID,
                derivationIndex: 0,
            }),
        ).toThrow(INCOMPLETE_SESSION_MESSAGE);
    });

    test("playground product id is pinned", () => {
        // playground-app derives MyApps ownership from this exact id; a silent
        // rename would orphan every published app.
        expect(PLAYGROUND_PRODUCT_ID).toEqual("playground.dot");
    });
});
