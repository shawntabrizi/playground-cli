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
import { ss58Encode } from "@parity/product-sdk-address";
import {
    checkAuthorization,
    type AuthorizationStatus,
    type CloudStorageApi,
} from "@parity/product-sdk-cloud-storage";
import {
    createSlotAccountSigner,
    ensureSlotAccountSigner,
    getCachedAllocation,
    requestResourceAllocation,
    type AllocatableResource,
} from "@parity/product-sdk-terminal/host";
import type { ResolvedSigner } from "../signer.js";

/**
 * Bridge the one nominal type skew between our bulletin chain API and
 * product-sdk's. We build the API from `@parity/product-sdk-descriptors`'
 * `bulletin` descriptor (`TypedApi<Paseo_bulletin>`); product-sdk's
 * `CloudStorageApi` is `@parity/bulletin-sdk`'s `BulletinTypedApi`, generated
 * from a different descriptor instance pinned at a slightly older product-sdk
 * version (the cdm-builder version skew documented in CLAUDE.md). The two are
 * structurally identical at runtime but nominally distinct to `tsc`. Cast
 * through this single seam so the skew lives in one deletable place — drop
 * this helper and inline its callers once the descriptor versions realign.
 *
 * The param is `unknown` on purpose: callers pass mutually-incompatible
 * nominal types (the descriptor `TypedApi<Paseo_bulletin>` from
 * `getConnection()`/`getTypedApi`, and cdm-env's `CdmBulletinApi` from the
 * contract chain client in `commands/contract.ts`). Narrowing the param to one
 * of them would re-couple the bridge to a single descriptor's structural shape
 * — the exact skew this seam exists to absorb — so leave it `unknown`.
 */
export function asCloudStorageApi(api: unknown): CloudStorageApi {
    return api as CloudStorageApi;
}

export const BULLETIN_RESOURCE: AllocatableResource = {
    tag: "BulletInAllowance",
    value: undefined,
};

const INIT_HINT = 'Run "playground init" to grant allowances.';

/**
 * Live handle for one in-flight phone approval. Close it exactly once: with
 * `complete()` when the wallet answered, or `fail(message)` when the request
 * threw / was declined.
 */
export interface AllowancePromptHandle {
    complete(): void;
    fail(message: string): void;
}

/**
 * Called right before a step that needs a tap on the phone (slot grant on
 * first use, quota Increase). RFC-0010 allocation requests travel over the
 * statement store outside any `PolkadotSigner`, so the deploy TUI's signing
 * proxy cannot see them — without this hook the phone shows an approval
 * dialog while the terminal sits silent.
 * `deploy/signingProxy.ts::createApprovalPrompt` builds a compatible
 * implementation backed by the deploy's shared step counter.
 */
export type AllowancePrompt = (label: string) => AllowancePromptHandle;

export interface BulletinAllowanceSignerOptions {
    publishSigner: ResolvedSigner;
    bulletinApi?: CloudStorageApi;
    requiredBytes?: number;
    /** Surfaces "check your phone" UI for allocation requests. Optional: headless callers omit it. */
    onPrompt?: AllowancePrompt;
}

function hasUsableAuthorization(status: AuthorizationStatus, requiredBytes = 0): boolean {
    return (
        status.authorized &&
        status.remainingTransactions > 0 &&
        status.remainingBytes >= BigInt(requiredBytes)
    );
}

export interface BulletinSlotAuthorization {
    address: string;
    status: AuthorizationStatus;
    usable: boolean;
}

/** On-chain authorization status of a slot signer's account. */
export async function getBulletinSlotAuthorization(
    bulletinApi: CloudStorageApi,
    slotSigner: PolkadotSigner,
    requiredBytes = 0,
): Promise<BulletinSlotAuthorization> {
    const address = ss58Encode(slotSigner.publicKey);
    const status = await checkAuthorization(bulletinApi, address);
    return { address, status, usable: hasUsableAuthorization(status, requiredBytes) };
}

/**
 * Authorization status of the CACHED Bulletin slot key, without going over
 * the wire to the phone. Returns null when no slot key is cached yet —
 * callers treat that as "needs a grant". Used by `playground init` to decide
 * whether to skip the approval dialog.
 */
export async function cachedBulletinSlotAuthorization(
    adapter: NonNullable<ResolvedSigner["adapter"]>,
    bulletinApi: CloudStorageApi,
    requiredBytes = 0,
): Promise<BulletinSlotAuthorization | null> {
    const slotSigner = await createSlotAccountSigner(adapter, BULLETIN_RESOURCE);
    if (!slotSigner) return null;
    return getBulletinSlotAuthorization(bulletinApi, slotSigner, requiredBytes);
}

function requireSession(publishSigner: ResolvedSigner) {
    const { userSession, adapter } = publishSigner;
    if (!userSession || !adapter) {
        throw new Error(`No Bulletin allowance account available. ${INIT_HINT}`);
    }
    return { userSession, adapter };
}

/**
 * Resolve the signer used for Bulletin `TransactionStorage.store` calls
 * (metadata uploads). Slot allocation, key caching and signer construction
 * are all the SDK's (`@parity/product-sdk-terminal/host`); this function owns
 * the QUOTA check: verify the slot's on-chain authorization and, when the
 * allowance is exhausted, make a single `Increase` retry on the phone.
 */
export async function getBulletinAllowanceSigner({
    publishSigner,
    bulletinApi,
    requiredBytes,
    onPrompt,
}: BulletinAllowanceSignerOptions): Promise<PolkadotSigner> {
    // Local dev/SURI deploys are the explicit CI escape hatch: the caller
    // supplied a local key and owns making sure it has Bulletin allowance.
    if (publishSigner.source === "dev") return publishSigner.signer;

    const { userSession, adapter } = requireSession(publishSigner);

    // Cache hit → local sr25519 signer; miss → one phone approval. The SDK
    // call owns allocation, caching, and signer construction (terminal 0.3.1+
    // derives the schnorrkel-normalized address for 64-byte phone-issued
    // keys, the one the chain actually granted to). The cache probe mirrors
    // ensureSlotAccountSigner's own hit/miss decision so the prompt fires
    // only when the phone will actually be asked.
    const cachedSlot = await getCachedAllocation(adapter, BULLETIN_RESOURCE);
    const grantPrompt = cachedSlot
        ? null
        : (onPrompt?.("Grant Bulletin storage allowance") ?? null);
    let slotSigner: PolkadotSigner;
    try {
        slotSigner = await ensureSlotAccountSigner(userSession, adapter, BULLETIN_RESOURCE);
        grantPrompt?.complete();
    } catch (err) {
        grantPrompt?.fail(err instanceof Error ? err.message : String(err));
        throw err;
    }
    if (!bulletinApi) return slotSigner;

    let authorization = await getBulletinSlotAuthorization(bulletinApi, slotSigner, requiredBytes);

    if (!authorization.usable && authorization.status.authorized) {
        // Slot exists on-chain but quota is exhausted: ask for one more slot.
        const increasePrompt = onPrompt?.("Increase Bulletin storage allowance") ?? null;
        try {
            await requestResourceAllocation(userSession, adapter, [BULLETIN_RESOURCE], {
                onExisting: "Increase",
            });
            increasePrompt?.complete();
        } catch (err) {
            increasePrompt?.fail(err instanceof Error ? err.message : String(err));
            throw err;
        }
        slotSigner = await ensureSlotAccountSigner(userSession, adapter, BULLETIN_RESOURCE);
        authorization = await getBulletinSlotAuthorization(bulletinApi, slotSigner, requiredBytes);
    }

    if (!authorization.usable) {
        const { address, status } = authorization;
        throw new Error(
            status.authorized
                ? `Bulletin allowance for ${address} is live but does not have enough quota. Re-run \`playground init\` and approve on your phone.`
                : `Bulletin allowance account ${address} is not authorized on-chain yet. Re-run \`playground init\` and approve on your phone.`,
        );
    }

    return slotSigner;
}

export function isInvalidPaymentError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return /"type"\s*:\s*"Invalid"[\s\S]*"type"\s*:\s*"Payment"/.test(message);
}
