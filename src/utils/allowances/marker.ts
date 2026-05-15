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
 * Local cache of "we already asked the host for allowance X on env Y for
 * address Z". RFC-0010 provides no on-chain query for allowance status, so
 * we persist a marker after a successful grant. Slot-account resources also
 * need the secret key cached in `allowance-keys.json`; callers that need to
 * sign must check both files before skipping the host round-trip.
 *
 * Stored at `$POLKADOT_ROOT/allowances.json` (default `~/.polkadot/`), mode
 * 0600, sibling to `accounts.json`. Keyed `env → ss58Address → resourceTag`
 * so switching env doesn't surface markers from another env.
 */

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Env } from "../../config.js";
import type { ResourceTag } from "./host.js";

// Resolved lazily so tests can override `POLKADOT_ROOT` per case. Reading
// `process.env` at module-load time would freeze the path before tests get a
// chance to point it at a temp dir.
function getRootDir(): string {
    return process.env.POLKADOT_ROOT ?? join(homedir(), ".polkadot");
}

function getMarkerPath(): string {
    return join(getRootDir(), "allowances.json");
}

interface ResourceEntry {
    grantedAt: number;
    /** "host" = RFC-0010 path, "alice" = legacy Alice-attested testnet path (retained for backfill). */
    source: "host" | "alice";
}

interface MarkerFile {
    version: 1;
    envs: Partial<Record<Env, Record<string, Partial<Record<ResourceTag, ResourceEntry>>>>>;
}

const EMPTY: MarkerFile = { version: 1, envs: {} };

async function loadFile(): Promise<MarkerFile> {
    let raw: string;
    try {
        raw = await fs.readFile(getMarkerPath(), "utf8");
    } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { ...EMPTY };
        throw err;
    }
    try {
        const parsed = JSON.parse(raw) as MarkerFile;
        if (parsed && parsed.version === 1 && parsed.envs && typeof parsed.envs === "object") {
            return parsed;
        }
    } catch {
        // Corrupt file — fall through and treat as empty. The next save
        // will overwrite. We intentionally don't surface the parse error
        // because the marker is best-effort UX, not load-bearing state.
    }
    return { ...EMPTY };
}

async function saveFile(file: MarkerFile): Promise<void> {
    await fs.mkdir(getRootDir(), { recursive: true, mode: 0o700 });
    await fs.writeFile(getMarkerPath(), JSON.stringify(file, null, 2), { mode: 0o600 });
}

export async function hasAllowance(
    env: Env,
    address: string,
    resource: ResourceTag,
): Promise<boolean> {
    const file = await loadFile();
    return Boolean(file.envs[env]?.[address]?.[resource]);
}

export async function markAllowance(
    env: Env,
    address: string,
    resource: ResourceTag,
    source: ResourceEntry["source"] = "host",
): Promise<void> {
    const file = await loadFile();
    const envBucket = file.envs[env] ?? {};
    const addrBucket = envBucket[address] ?? {};
    addrBucket[resource] = { grantedAt: Date.now(), source };
    envBucket[address] = addrBucket;
    file.envs[env] = envBucket;
    await saveFile(file);
}

export async function clearForEnv(env: Env): Promise<void> {
    const file = await loadFile();
    if (!file.envs[env]) return;
    delete file.envs[env];
    await saveFile(file);
}

/** Visible for tests; not part of the public API. @internal */
export const _internal = { getMarkerPath, loadFile, saveFile };
