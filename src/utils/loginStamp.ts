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
 * Local record of when the user last completed a QR login.
 *
 * Why: the statement-store (SSS) allowance that carries every phone
 * interaction is a 1-day renewable resource with a ~2-day grace window, and
 * there is NO on-chain query for it (confirmed by the bulletin-deploy
 * investigation: the SSS account appears in zero storage keys even while
 * working). The only reliable signal we can have is "when did the user last
 * pair", so we stamp it ourselves at login and use it as a warn-only
 * heuristic before phone-mode deploys.
 *
 * The stamp lives in the SDK storage dir under the `dot-cli_` prefix so
 * `playground logout` (`clearLocalAppStorage`, which unlinks `${DAPP_ID}_*`)
 * removes it together with the session it describes. Both I/O helpers are
 * best-effort: a missing, corrupt, or unwritable stamp must never affect the
 * login or deploy flows — the worst case is simply "no warning".
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DAPP_ID } from "../config.js";

const STAMP_FILE = `${DAPP_ID}_LoginStamp.json`;

/** ~2-3 days after login the SSS allowance is gone; warn from 2 days on. */
const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

function stampPath(storageDir?: string): string {
    return join(storageDir ?? join(homedir(), ".polkadot-apps"), STAMP_FILE);
}

/** Best-effort write of the login moment. Never throws. */
export async function recordLoginStamp(nowMs: number = Date.now(), storageDir?: string) {
    try {
        const path = stampPath(storageDir);
        await mkdir(join(path, ".."), { recursive: true, mode: 0o700 });
        await writeFile(path, `${JSON.stringify({ lastLoginAt: nowMs })}\n`, { mode: 0o600 });
    } catch {
        // The stamp only powers a warning heuristic — losing it is fine.
    }
}

/** Last recorded login time in epoch ms, or null when absent/corrupt. */
export async function readLoginStampMs(storageDir?: string): Promise<number | null> {
    try {
        const raw = await readFile(stampPath(storageDir), "utf-8");
        const parsed: unknown = JSON.parse(raw);
        const value = (parsed as { lastLoginAt?: unknown })?.lastLoginAt;
        return typeof value === "number" && Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

/**
 * Warn-only staleness check. Returns the warning text when the last login is
 * more than 2 days old, null otherwise. No stamp (pre-stamp sessions) and
 * future stamps (clock skew) produce no warning — this heuristic must never
 * block or scare users whose sessions still work; the SSS fast-fail in
 * `sessionSigner.ts` is the authoritative runtime signal.
 */
export function staleSessionWarning(lastLoginAtMs: number | null, nowMs: number): string | null {
    if (lastLoginAtMs === null) return null;
    const age = nowMs - lastLoginAtMs;
    if (age <= STALE_AFTER_MS) return null;

    const days = Math.floor(age / (24 * 60 * 60 * 1000));
    return (
        `warning: your phone session was paired ${days} days ago. Phone signing stops ` +
        "working ~2 days after login (the statement-store allowance expires and cannot be " +
        'renewed remotely). If signing hangs or fails, run "playground logout" and then ' +
        '"playground init" to pair again.'
    );
}
