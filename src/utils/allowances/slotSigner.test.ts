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

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toHex } from "polkadot-api/utils";
import { ss58Encode } from "@parity/product-sdk-address";
import * as scure from "@scure/sr25519";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCachedBulletinSlotSigner, slotSignerFromSecret } from "./slotSigner.js";

// Synthetic 64-byte schnorrkel-form secret (scalar half kept small so the x8
// normalization cannot overflow). The expected SS58 strings were computed
// INDEPENDENTLY of the implementation (scure.getPublicKey over the normalized
// and raw forms respectively) and frozen here. The on-chain ground truth this
// encodes: the mobile app grants the Bulletin allowance to the address derived
// with native schnorrkel semantics from SecretKey::to_bytes() material, which
// equals the scure derivation only AFTER the x8 scalar normalization
// (verified live on paseo-next-v2 against a real phone-issued grant; mirrors
// bulletin-deploy's storage-signer.ts).
function syntheticKey64(): Uint8Array {
    const key = new Uint8Array(64);
    for (let i = 0; i < 64; i++) key[i] = (i + 1) & 0xff;
    key[31] = 0x05;
    return key;
}
const NORMALIZED_SS58 = "5ExnAobD7b4JrdLDxD2n1fDxDGYNVG6yxqR2u1wJpZGq7jQB";
const RAW_SS58 = "5CLqjRkNgmLe3csvp73rgGCqKdS7NYmk93c9JZ7udPdS3anY";

describe("slotSignerFromSecret", () => {
    it("64-byte key: derives the schnorrkel-normalized address, not the raw scure one", () => {
        const signer = slotSignerFromSecret(syntheticKey64());
        const address = ss58Encode(signer.publicKey);
        expect(address).toBe(NORMALIZED_SS58);
        // The unnormalized derivation is precisely the bug this module fixes
        // (product-sdk's createSlotAccountSigner derives this address, which
        // the chain has never granted anything to).
        expect(address).not.toBe(RAW_SS58);
    });

    it("64-byte key: signatures verify against the derived public key", async () => {
        const signer = slotSignerFromSecret(syntheticKey64());
        const payload = new TextEncoder().encode("chunk payload");
        const signature = await signer.signBytes(payload);
        // PAPI's signBytes applies the <Bytes>...</Bytes> anti-phishing
        // envelope before signing; verify against the wrapped form.
        const enc = new TextEncoder();
        const wrapped = new Uint8Array([
            ...enc.encode("<Bytes>"),
            ...payload,
            ...enc.encode("</Bytes>"),
        ]);
        expect(scure.verify(wrapped, signature, signer.publicKey)).toBe(true);
    });

    it("32-byte key: treated as a mini-secret seed", () => {
        const seed = new Uint8Array(32).fill(7);
        const signer = slotSignerFromSecret(seed);
        expect(ss58Encode(signer.publicKey)).toBe(
            "5EsNLFaGe9XK5LzWH3i6eC2Wqv6YqZS1442N1C4yeSdP6uxy",
        );
    });

    it("rejects unexpected key lengths", () => {
        expect(() => slotSignerFromSecret(new Uint8Array(33))).toThrow(/33/);
    });
});

describe("readCachedBulletinSlotSigner", () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "playground-slot-signer-"));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function writeCache(content: unknown) {
        writeFileSync(
            join(dir, "dot-cli_AllowanceKeys.json"),
            typeof content === "string" ? content : JSON.stringify(content),
        );
    }

    it("derives the normalized signer from a cached 64-byte key", async () => {
        writeCache({
            version: 1,
            entries: {
                BulletInAllowance: {
                    tag: "BulletInAllowance",
                    slotAccountKey: toHex(syntheticKey64()),
                },
            },
        });
        const signer = await readCachedBulletinSlotSigner(dir);
        expect(signer).not.toBeNull();
        expect(ss58Encode(signer!.publicKey)).toBe(NORMALIZED_SS58);
    });

    it("returns null when the cache file is missing", async () => {
        await expect(readCachedBulletinSlotSigner(dir)).resolves.toBeNull();
    });

    it("returns null when the cache has no BulletInAllowance entry", async () => {
        writeCache({ version: 1, entries: {} });
        await expect(readCachedBulletinSlotSigner(dir)).resolves.toBeNull();
    });

    it("returns null on corrupt content instead of throwing", async () => {
        writeCache("not json");
        await expect(readCachedBulletinSlotSigner(dir)).resolves.toBeNull();
    });
});
