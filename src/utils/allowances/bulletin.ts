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
import { getChainConfig, PLAYGROUND_PRODUCT_ID, type Env } from "../../config.js";
import type { ResolvedSigner } from "../signer.js";
import {
    createSlotAccountSigner,
    getSlotAccountKeyCandidates,
    readSlotAccountKey,
    storeSlotAccountKeysFromOutcomes,
} from "./slotKeys.js";
import { requestResourceAllocation, type AllocationOutcome } from "./host.js";

export interface BulletinAllowanceSignerOptions {
    env: Env;
    ownerAddress: string;
    publishSigner: ResolvedSigner;
    bulletinApi?: BulletinApi;
    requiredBytes?: number;
}

export function bulletinAuthorizationHelp(
    slotAccountAddress: string,
    faucetUrl: string | null = getChainConfig().bulletinAuthorizationUrl,
): string {
    return faucetUrl
        ? `Open the Bulletin authorization faucet at ${faucetUrl} and authorize account ${slotAccountAddress}, then re-run \`dot init\`.`
        : `Bulletin allowance account ${slotAccountAddress} is not authorized yet. Re-run \`dot init\` after authorizing it.`;
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

export interface BulletinSlotAuthorization {
    slotAccountKey: Uint8Array;
    address: string;
    status: Awaited<ReturnType<typeof checkAuthorization>>;
    usable: boolean;
}

export async function hasUsableBulletinSlotAuthorization(
    bulletinApi: BulletinApi,
    slotAccountKey: Uint8Array,
    requiredBytes = 0,
): Promise<boolean> {
    const authorization = await getBulletinSlotAuthorization(
        bulletinApi,
        slotAccountKey,
        requiredBytes,
    );
    return authorization.usable;
}

export async function getBulletinSlotAuthorization(
    bulletinApi: BulletinApi,
    slotAccountKey: Uint8Array,
    requiredBytes = 0,
): Promise<BulletinSlotAuthorization> {
    const candidates = getSlotAccountKeyCandidates(slotAccountKey);
    const checked: BulletinSlotAuthorization[] = [];

    for (const candidate of candidates) {
        const status = await checkAuthorization(bulletinApi, candidate.address);
        const usable = hasUsableAuthorization(status, requiredBytes);
        const authorization = {
            slotAccountKey: candidate.slotAccountKey,
            address: candidate.address,
            status,
            usable,
        };
        if (usable || status.authorized) return authorization;
        checked.push(authorization);
    }

    return checked.find((authorization) => authorization.status.authorized) ?? checked[0];
}

function allocatedBulletinKey(outcomes: AllocationOutcome[]): Uint8Array | null {
    for (const outcome of outcomes) {
        if (outcome.tag !== "Allocated") continue;
        const value = outcome.value as
            | { tag?: string; value?: { slotAccountKey?: Uint8Array } }
            | undefined;
        if (value?.tag !== "BulletInAllowance") continue;
        return value.value?.slotAccountKey instanceof Uint8Array
            ? value.value.slotAccountKey
            : null;
    }
    return null;
}

async function requestBulletinAllowanceKey(
    { env, ownerAddress, publishSigner }: BulletinAllowanceSignerOptions,
    onExisting: "Ignore" | "Increase",
): Promise<Uint8Array> {
    if (!publishSigner.userSession) {
        throw new Error(
            'No Bulletin allowance account cached. Run "dot init" to grant allowances.',
        );
    }

    const outcomes = await requestResourceAllocation(
        publishSigner.userSession,
        PLAYGROUND_PRODUCT_ID,
        [{ tag: "BulletInAllowance", value: undefined }],
        onExisting,
    );
    await storeSlotAccountKeysFromOutcomes(env, ownerAddress, outcomes);

    const key = allocatedBulletinKey(outcomes);
    const cached = await readSlotAccountKey(env, ownerAddress, "BulletInAllowance");
    if (cached) return cached;

    if (key) return key;
    const outcome = outcomes[0];
    throw new Error(
        `Bulletin allowance allocation ${outcome?.tag ?? "returned no outcome"}. Re-run \`dot init\` and approve on your phone.`,
    );
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

    let key = await readSlotAccountKey(env, ownerAddress, "BulletInAllowance");
    if (!key) {
        key = await requestBulletinAllowanceKey(
            { env, ownerAddress, publishSigner, bulletinApi, requiredBytes },
            "Ignore",
        );
    }

    if (!bulletinApi) return createSlotAccountSigner(key);

    let authorization = await getBulletinSlotAuthorization(bulletinApi, key, requiredBytes);
    if (!authorization.usable && authorization.status.authorized) {
        key = await requestBulletinAllowanceKey(
            { env, ownerAddress, publishSigner, bulletinApi, requiredBytes },
            "Increase",
        );
        authorization = await getBulletinSlotAuthorization(bulletinApi, key, requiredBytes);
    }

    if (!authorization.usable) {
        const address = authorization.address;
        throw new Error(
            authorization.status.authorized
                ? `Bulletin allowance for ${address} is live but does not have enough quota. ${bulletinAuthorizationHelp(address)}`
                : `Bulletin allowance account ${address} is not authorized. ${bulletinAuthorizationHelp(address)}`,
        );
    }

    return createSlotAccountSigner(authorization.slotAccountKey);
}

export function isInvalidPaymentError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /"type"\s*:\s*"Invalid"[\s\S]*"type"\s*:\s*"Payment"/.test(message);
}
