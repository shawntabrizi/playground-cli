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
 * Up-front quota context for the Bulletin storage upload.
 *
 * The slot account's on-chain allowance is finite (observed grants:
 * 10 transactions / 4 MiB per claim) while an app's CAR can easily exceed
 * that (each chunk is up to 2 MiB). Without a pre-flight check the upload
 * dies mid-flight with Payment dispatch errors — and mid-upload failures do
 * NOT fall back to the pool (only a failure on first connection does, see
 * bulletin-deploy's `selectStorageReconnect`). This module supplies
 * `resolveStorageSignerOptions` with the two inputs it needs to verify the
 * extent up front and trigger the one-tap `Increase` flow when short:
 * a size estimate and a short-lived Bulletin API handle.
 *
 * Everything here is best-effort: estimate or client-construction failures
 * yield `null`, which downgrades the deploy to the no-quota-check behavior
 * rather than blocking it.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { paseo_bulletin as bulletin } from "@parity/product-sdk-descriptors/paseo-bulletin";
import type { CloudStorageApi } from "@parity/product-sdk-cloud-storage";
import { getChainConfig, type Env } from "../../config.js";
import { BULLETIN_WS_HEARTBEAT_MS } from "../bulletinWs.js";

/**
 * CAR encoding adds block headers, DAG-PB structure nodes, and the root
 * manifest on top of the raw file bytes. 15% headroom comfortably covers the
 * observed overhead while keeping the estimate conservative enough that a
 * passing check cannot strand an upload just short of quota.
 */
export const CAR_OVERHEAD_FACTOR = 1.15;

/**
 * Estimate the Bulletin upload size for a build directory (or single file):
 * recursive raw byte sum times {@link CAR_OVERHEAD_FACTOR}. Returns null when
 * the path is unreadable — callers treat that as "skip the quota check".
 *
 * Symlinked entries are excluded (Dirent.isFile/isDirectory are false for
 * symlinks, so the walk neither counts nor follows them — directory cycles
 * are impossible). Build outputs don't normally contain symlinks; a small
 * undercount is acceptable for a best-effort estimate.
 */
export function estimateUploadBytes(path: string): number | null {
    try {
        return Math.ceil(rawSize(path) * CAR_OVERHEAD_FACTOR);
    } catch {
        return null;
    }
}

function rawSize(path: string): number {
    const stat = statSync(path);
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    let total = 0;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isFile()) total += statSync(child).size;
        else if (entry.isDirectory()) total += rawSize(child);
    }
    return total;
}

export interface StorageQuotaContext {
    bulletinApi: CloudStorageApi;
    requiredBytes: number;
    /** Tears down the dedicated WS client. Always call from `finally`. */
    destroy(): void;
}

/**
 * Build the quota context for a phone-mode deploy: a size estimate plus a
 * DEDICATED short-lived Bulletin client (same 300 s heartbeat rationale as
 * the metadata upload in `playground.ts` — the shared client's 40 s default
 * is too tight for Bulletin round-trips). Returns null when the estimate or
 * client construction fails; the caller then proceeds without a quota check,
 * which is exactly the pre-gate behavior.
 */
export function createStorageQuotaContext(
    env: Env | undefined,
    contentPath: string,
): StorageQuotaContext | null {
    const requiredBytes = estimateUploadBytes(contentPath);
    if (requiredBytes === null) return null;
    try {
        const cfg = getChainConfig(env);
        const client = createClient(
            getWsProvider([cfg.bulletinRpc, ...cfg.bulletinRpcFallbacks], {
                heartbeatTimeout: BULLETIN_WS_HEARTBEAT_MS,
            }),
        );
        return {
            bulletinApi: client.getTypedApi(bulletin) as unknown as CloudStorageApi,
            requiredBytes,
            destroy: () => client.destroy(),
        };
    } catch {
        return null;
    }
}
