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

import type { PolkadotSigner } from "polkadot-api";
import { checkAuthorization, type BulletinApi } from "@parity/product-sdk-bulletin";
import { BULLETIN_AUTHORIZATION_URL, type Env } from "../../config.js";
import type { ResolvedSigner } from "../signer.js";
import {
    createSlotAccountSigner,
    getOrCreateSlotAccountKey,
    getSlotAccountAddress,
} from "./slotKeys.js";

export interface BulletinAllowanceSignerOptions {
    env: Env;
    ownerAddress: string;
    publishSigner: ResolvedSigner;
    bulletinApi?: BulletinApi;
    requiredBytes?: number;
}

export function bulletinAuthorizationHelp(slotAccountAddress: string): string {
    return `Open the Bulletin authorization faucet at ${BULLETIN_AUTHORIZATION_URL} and authorize account ${slotAccountAddress}, then re-run \`dot init\`.`;
}

function hasUsableAuthorization(
    status: Awaited<ReturnType<typeof checkAuthorization>>,
    requiredBytes = 0,
): boolean {
    return (
        status.authorized &&
        status.remainingTransactions > 0 &&
        status.remainingBytes >= BigInt(requiredBytes)
    );
}

export async function hasUsableBulletinSlotAuthorization(
    bulletinApi: BulletinApi,
    slotAccountKey: Uint8Array,
    requiredBytes = 0,
): Promise<boolean> {
    const status = await getBulletinSlotAuthorization(bulletinApi, slotAccountKey);
    return hasUsableAuthorization(status, requiredBytes);
}

async function getBulletinSlotAuthorization(
    bulletinApi: BulletinApi,
    slotAccountKey: Uint8Array,
): Promise<Awaited<ReturnType<typeof checkAuthorization>>> {
    return await checkAuthorization(bulletinApi, getSlotAccountAddress(slotAccountKey));
}

export async function getBulletinAllowanceSigner({
    env,
    ownerAddress,
    publishSigner,
    bulletinApi,
    requiredBytes,
}: BulletinAllowanceSignerOptions): Promise<PolkadotSigner> {
    // Local dev/SURI deploys are the explicit CI escape hatch: the caller
    // supplied a local key and owns making sure it has Bulletin allowance.
    if (publishSigner.source === "dev") return publishSigner.signer;

    const key = await getOrCreateSlotAccountKey(env, ownerAddress, "BulletInAllowance");

    if (!bulletinApi) return createSlotAccountSigner(key);

    const status = await getBulletinSlotAuthorization(bulletinApi, key);
    if (!hasUsableAuthorization(status, requiredBytes)) {
        const address = getSlotAccountAddress(key);
        throw new Error(
            status.authorized
                ? `Bulletin allowance for ${address} is live but does not have enough quota. ${bulletinAuthorizationHelp(address)}`
                : `Bulletin allowance account ${address} is not authorized. ${bulletinAuthorizationHelp(address)}`,
        );
    }

    return createSlotAccountSigner(key);
}

export function isInvalidPaymentError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /"type"\s*:\s*"Invalid"[\s\S]*"type"\s*:\s*"Payment"/.test(message);
}
