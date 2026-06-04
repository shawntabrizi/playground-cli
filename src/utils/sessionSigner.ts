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
    return wrapSignerWithSssFastFail(createSessionSignerForAccount(session, { ...ref, publicKey }));
}

export const SESSION_EXPIRED_MESSAGE =
    "Phone session expired: the statement-store allowance lapses ~2-3 days after login " +
    "and cannot be renewed remotely (renewal requests travel over the expired channel). " +
    'Run "playground logout" and then "playground init" to pair again.';

/**
 * Fast-fail for expired statement-store (SSS) allowances.
 *
 * Phone signing rides the statement store: `session.createTransaction` /
 * `session.signRaw` submit a statement on the People chain that the phone
 * subscribes to. The SSS allowance is a 1-day renewable resource (plus a
 * grace window, ~2-3 days total after login). When it lapses, the
 * statement-store adapter logs `NoAllowanceError` to `console.error` but
 * does NOT reject the promise — the signing call hangs for the SDK's 180s
 * queue timeout while the outer transaction watcher gives up at 90s with a
 * misleading "transaction watcher silent" error, times 3 retries.
 *
 * This wrapper intercepts `console.error` for the duration of each signing
 * call, detects the NoAllowanceError line, and rejects within ~200ms with an
 * actionable message. Renewal genuinely requires re-pairing: the
 * `requestResourceAllocation` that would extend the allowance itself travels
 * over SSS, and only the QR login flow has a direct WebSocket channel.
 * Mirrors bulletin-deploy's vendored `sessionSigner.ts` fast-fail, which does
 * not cover us because we inject our own signer.
 *
 * Re-entrancy: the deploy pipeline (`deploy/storage.ts::interceptConsoleLog`)
 * also swaps `console.error`. We capture whatever `console.error` is at call
 * time and restore exactly that in `finally`, so the interceptions nest.
 * Overlapping signing calls cannot interleave restores in practice —
 * host-papp serializes all session operations through a poolSize-1 queue.
 * A matched line is suppressed (the thrown error IS the user-facing
 * message); everything else is forwarded.
 *
 * On a fast-fail the underlying signing promise is intentionally abandoned
 * (it never settles in this failure mode — that's the bug). If it ever does
 * settle later, Promise.race has both arms handled, so no unhandled
 * rejection escapes; any post-restore NoAllowanceError lines simply land on
 * the regular console.error.
 */
export function wrapSignerWithSssFastFail(signer: PolkadotSigner): PolkadotSigner {
    function wrap<Args extends unknown[], R>(
        fn: (...args: Args) => Promise<R>,
    ): (...args: Args) => Promise<R> {
        return async (...args: Args): Promise<R> => {
            let sawNoAllowance = false;
            const previousError = console.error;
            console.error = (...errArgs: unknown[]) => {
                const line = errArgs.map(String).join(" ");
                if (line.includes("NoAllowanceError") || line.includes("no allowance set")) {
                    sawNoAllowance = true;
                    return; // suppressed — SESSION_EXPIRED_MESSAGE replaces the raw stack
                }
                previousError(...errArgs);
            };

            let poll: ReturnType<typeof setInterval> | null = null;
            try {
                return await Promise.race([
                    fn(...args),
                    new Promise<never>((_, reject) => {
                        poll = setInterval(() => {
                            if (sawNoAllowance) reject(new Error(SESSION_EXPIRED_MESSAGE));
                        }, 200);
                    }),
                ]);
            } finally {
                // Both arms are settled or abandoned here: the interval must
                // die (it would otherwise keep the event loop alive — see
                // process-guard), and console.error must be restored to
                // whatever interceptor was active when we started.
                if (poll !== null) clearInterval(poll);
                console.error = previousError;
            }
        };
    }

    return {
        publicKey: signer.publicKey,
        signTx: wrap(signer.signTx.bind(signer)),
        signBytes: wrap(signer.signBytes.bind(signer)),
    };
}
