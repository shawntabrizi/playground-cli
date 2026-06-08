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
 * Device-identity rotation for a fresh QR pairing.
 *
 * ## Why this exists
 *
 * The mobile SSO channel is a statement-store topic
 * `createSessionId(sessionKey, phoneAccount, hostAccount)` (see
 * `@novasamatech/statement-store`'s `createSession`). Two of the three inputs
 * are stable across re-pairings:
 *
 *   - `phoneAccount` / `sessionKey` — the phone derives its session account
 *     deterministically from its wallet, so it is byte-identical every time you
 *     re-pair the same phone with the same app. (Proven on-device: the SAME
 *     phone-generated message IDs decrypt across independent local sessions,
 *     which is only possible if the remote account — and therefore the
 *     per-session encryption key and the topic — is shared.)
 *   - `hostAccount` — the host's statement account, derived from the persisted
 *     `DeviceIdentity` blob (`@novasamatech/host-papp`'s `deviceIdentityStore`).
 *     `loadOrCreate()` reuses it forever once written.
 *
 * So the channel topic is effectively constant for a given (phone, host
 * install) pair. The phone posts a `Disconnected` request statement on that
 * topic whenever it supersedes a session (e.g. on re-pair), and statements live
 * for SEVEN DAYS (`DEFAULT_EXPIRY_DURATION_SECS`). When the next pairing
 * establishes a new session on the same topic, `createSession.init()` queries
 * the topic history and re-delivers that unresponded `Disconnected`; host-papp's
 * session manager reacts by removing the just-paired session from
 * `SsoSessionsV2` (the secret blobs are left behind). The net effect is an empty
 * session repository the instant `playground init` finishes — every later
 * command then fails with "No signer available".
 *
 * Rotating the host `DeviceIdentity` changes `hostAccount`, which moves the new
 * pairing onto a brand-new topic with no statement history at all — immune to
 * the stale `Disconnected`. It is also the only way to escape an
 * already-poisoned topic without waiting out the 7-day statement TTL. A fresh
 * QR pairing re-establishes the statement-store ring slot anyway, so abandoning
 * the previous device identity costs nothing.
 *
 * We deliberately delete only the identity + the (already wiped) session list,
 * NOT the cached allowance slot keys (`AllowanceKeys`) or the login stamp —
 * those are not part of the topic and re-fetching them needs phone taps.
 */

import type { Dirent } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DAPP_ID } from "../config.js";

/**
 * Storage keys (sans the `${DAPP_ID}_` prefix and `.json` suffix) deleted on a
 * fresh pairing. `DeviceIdentity` rotates the host statement account (the topic
 * key we control); `SsoSessionsV2` is the session list, which must rotate in
 * lockstep with the identity it is bound to. Everything else — `AllowanceKeys`,
 * `LoginStamp`, the per-session `UserSecretsV2_*` / `sso_processed_*` orphans —
 * is left untouched (harmless, and not worth re-acquiring or risking on a
 * transient session-probe miss).
 */
const ROTATE_KEYS: readonly string[] = ["DeviceIdentity", "SsoSessionsV2"];

/**
 * Delete the topic-binding local state so the next QR pairing starts on a
 * pristine statement-store topic. Best-effort and never throws: a failure here
 * just leaves the old (possibly poisoned) topic in place, which is no worse
 * than not rotating at all.
 *
 * Exported for tests.
 */
export async function resetDeviceIdentityForFreshPairing(
    dir: string = join(homedir(), ".polkadot-apps"),
): Promise<void> {
    let entries: Dirent[];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        // Directory missing (never paired) — nothing to rotate.
        return;
    }
    const prefix = `${DAPP_ID}_`;
    await Promise.all(
        entries
            .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
            .filter((entry) => {
                const key = entry.name.slice(prefix.length).replace(/\.json$/, "");
                return ROTATE_KEYS.includes(key);
            })
            .map((entry) =>
                unlink(join(dir, entry.name)).catch(() => {
                    // best-effort
                }),
            ),
    );
}
