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
import type { Env } from "../../config.js";
import type { ResolvedSigner } from "../signer.js";
import { requestResourceAllocation, type OnExistingAllowancePolicy } from "./host.js";
import { markAllowance } from "./marker.js";
import {
    createSlotAccountSigner,
    extractSlotAccountKey,
    getSlotAccountAddress,
    readSlotAccountKey,
    storeSlotAccountKey,
} from "./slotKeys.js";

export interface BulletinAllowanceSignerOptions {
    env: Env;
    ownerAddress: string;
    productId: string;
    publishSigner: ResolvedSigner;
    bulletinApi?: BulletinApi;
    requiredBytes?: number;
    onRequest?: (policy: OnExistingAllowancePolicy) => void;
}

const BULLETIN_AUTH_WAIT_MS = 75_000;
const BULLETIN_AUTH_POLL_MS = 3_000;

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
    const address = getSlotAccountAddress(slotAccountKey);
    const status = await checkAuthorization(bulletinApi, address);
    return hasUsableAuthorization(status, requiredBytes);
}

export async function waitForBulletinSlotAuthorization(
    bulletinApi: BulletinApi,
    slotAccountKey: Uint8Array,
    requiredBytes = 0,
): Promise<void> {
    const deadline = Date.now() + BULLETIN_AUTH_WAIT_MS;
    const address = getSlotAccountAddress(slotAccountKey);
    let lastAuthorized = false;

    while (Date.now() <= deadline) {
        const status = await checkAuthorization(bulletinApi, address);
        lastAuthorized = status.authorized;
        if (hasUsableAuthorization(status, requiredBytes)) return;
        await new Promise((resolve) => setTimeout(resolve, BULLETIN_AUTH_POLL_MS));
    }

    throw new Error(
        lastAuthorized
            ? `Bulletin allowance for ${address} is live but does not have enough quota.`
            : `Mobile returned Bulletin allowance key ${address}, but it is not authorized on Bulletin yet.`,
    );
}

export async function getBulletinAllowanceSigner({
    env,
    ownerAddress,
    productId,
    publishSigner,
    bulletinApi,
    requiredBytes,
    onRequest,
}: BulletinAllowanceSignerOptions): Promise<PolkadotSigner> {
    // Local dev/SURI deploys are the explicit CI escape hatch: the caller
    // supplied a local key and owns making sure it has Bulletin allowance.
    if (publishSigner.source === "dev") return publishSigner.signer;

    const cached = await readSlotAccountKey(env, ownerAddress, "BulletInAllowance");
    if (cached) {
        if (!bulletinApi) return createSlotAccountSigner(cached);
        if (await hasUsableBulletinSlotAuthorization(bulletinApi, cached, requiredBytes)) {
            return createSlotAccountSigner(cached);
        }
        if (!publishSigner.userSession) {
            throw new Error("Cached Bulletin allowance key is not authorized. Run `dot init`.");
        }
        return await requestAndStoreBulletinAllowanceSigner({
            env,
            ownerAddress,
            productId,
            publishSigner,
            bulletinApi,
            requiredBytes,
            policy: "Ignore",
            onRequest,
        });
    }

    if (!publishSigner.userSession) {
        throw new Error("Bulletin allowance key missing. Run `dot init` and approve allowances.");
    }

    return await requestAndStoreBulletinAllowanceSigner({
        env,
        ownerAddress,
        productId,
        publishSigner,
        bulletinApi,
        requiredBytes,
        policy: "Ignore",
        onRequest,
    });
}

export async function requestAndStoreBulletinAllowanceSigner({
    env,
    ownerAddress,
    productId,
    publishSigner,
    bulletinApi,
    requiredBytes,
    policy,
    onRequest,
}: BulletinAllowanceSignerOptions & {
    policy: OnExistingAllowancePolicy;
}): Promise<PolkadotSigner> {
    if (publishSigner.source === "dev") return publishSigner.signer;
    if (!publishSigner.userSession) {
        throw new Error("Cannot request Bulletin allowance without an active mobile session.");
    }

    onRequest?.(policy);
    const outcomes = await requestResourceAllocation(
        publishSigner.userSession,
        productId,
        [{ tag: "BulletInAllowance", value: undefined }],
        policy,
    );
    const key = extractSlotAccountKey(outcomes, "BulletInAllowance");
    if (!key) {
        const outcome = outcomes[0]?.tag ?? "missing";
        throw new Error(`Bulletin allowance was not granted (${outcome}).`);
    }

    if (bulletinApi) {
        await waitForBulletinSlotAuthorization(bulletinApi, key, requiredBytes);
    }

    await storeSlotAccountKey(env, ownerAddress, "BulletInAllowance", key);
    await markAllowance(env, ownerAddress, "BulletInAllowance", "host");
    return createSlotAccountSigner(key);
}

export function isInvalidPaymentError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /"type"\s*:\s*"Invalid"[\s\S]*"type"\s*:\s*"Payment"/.test(message);
}
