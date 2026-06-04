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
 * Slot-account signer with the CORRECT public-key derivation for keys issued
 * by the mobile app.
 *
 * Why this exists: the mobile returns `slotAccountKey` as 64 bytes of
 * schnorrkel `SecretKey::to_bytes()` material ("32-byte sr25519 private key
 * concatenated with 32-byte nonce", polkadot-app-android-v2's
 * `SlotAccountKey.kt`), and grants the on-chain allowance to the AccountId it
 * derives natively from those bytes (`RealAccountsProtocol.kt` →
 * `claim_long_term_storage`). `@scure/sr25519` expects the ed25519-expanded
 * scalar form (`to_ed25519_bytes()`, scalar ×8), so deriving a public key
 * from the raw bytes yields a DIFFERENT address that the chain has never
 * granted anything to. `@parity/product-sdk-terminal/host`'s
 * `createSlotAccountSigner` has exactly that bug; until it is fixed upstream,
 * every signer built from the allowance cache must come from here instead.
 * Verified live on paseo-next-v2: the phone-issued grant sits on the
 * normalized address, the raw-derived address has no on-chain footprint.
 * Mirrors bulletin-deploy's `storage-signer.ts` (shipped in 0.8.3).
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fromHex } from "polkadot-api/utils";
import { getPolkadotSigner } from "polkadot-api/signer";
import type { PolkadotSigner } from "polkadot-api";
import * as sr25519 from "@scure/sr25519";
import { DAPP_ID } from "../../config.js";

/**
 * Convert a schnorrkel `SecretKey::to_bytes()` scalar (canonical form) to the
 * `to_ed25519_bytes()` form `@scure/sr25519` expects: multiply the scalar
 * half (bytes 0-31, little-endian) by the cofactor 8. The nonce half (bytes
 * 32-63) is unchanged. 32-byte mini-secrets pass through untouched.
 */
export function normalizeSchnorrkelScalar(key: Uint8Array): Uint8Array {
    if (key.length !== 64) return key;
    const out = new Uint8Array(key);
    let carry = 0;
    for (let i = 0; i < 32; i++) {
        const v = key[i] * 8 + carry;
        out[i] = v & 0xff;
        carry = v >> 8;
    }
    return out;
}

/**
 * Build a `PolkadotSigner` from slot-key secret material.
 *  - 64 bytes: phone-issued schnorrkel `to_bytes()` form — normalized first.
 *  - 32 bytes: mini-secret seed — expanded via `secretFromSeed`.
 */
export function slotSignerFromSecret(secret: Uint8Array): PolkadotSigner {
    let expanded: Uint8Array;
    if (secret.length === 64) {
        expanded = normalizeSchnorrkelScalar(secret);
    } else if (secret.length === 32) {
        expanded = sr25519.secretFromSeed(secret);
    } else {
        throw new Error(
            `Bulletin slot key: unexpected length ${secret.length} (expected 32 or 64 bytes)`,
        );
    }
    const publicKey = sr25519.getPublicKey(expanded);
    return getPolkadotSigner(publicKey, "Sr25519", async (data) => sr25519.sign(expanded, data));
}

// Mirrors product-sdk-terminal's sanitizeAppId (host.js) so the filename we
// read matches the one the SDK writes for any appId.
function sanitizeAppId(appId: string): string {
    return appId.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

/**
 * Read the BulletInAllowance slot key from the product-sdk-terminal allowance
 * cache (`<storageDir>/<appId>_AllowanceKeys.json`, v1 format — the same
 * file `ensureSlotAccountSigner` writes) and derive the CORRECT signer from
 * it. Returns null when the cache or entry is missing or unreadable — callers
 * fall back to the SDK signer, which keeps behavior identical to today's on
 * machines without a cached key.
 *
 * `storageDir`/`appId` must come from the SAME adapter that ran
 * `ensureSlotAccountSigner` (it exposes both as readonly fields) — a
 * mismatched namespace reads a stale or absent key and silently falls back
 * to the SDK's wrong-address signer.
 */
export async function readCachedBulletinSlotSigner(
    storageDir?: string,
    appId: string = DAPP_ID,
): Promise<PolkadotSigner | null> {
    try {
        const path = join(
            storageDir ?? join(homedir(), ".polkadot-apps"),
            `${sanitizeAppId(appId)}_AllowanceKeys.json`,
        );
        const cache = JSON.parse(await readFile(path, "utf-8"));
        const hex = cache?.entries?.BulletInAllowance?.slotAccountKey;
        if (typeof hex !== "string") return null;
        return slotSignerFromSecret(fromHex(hex));
    } catch {
        return null;
    }
}
