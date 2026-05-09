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
 * Bulletin attestation — read current authorization, format for the TUI.
 *
 * Bulletin authorizations (`TransactionStorage.Authorizations`) carry an
 * explicit `expiration` block number. `dot init` surfaces this on every run
 * so users can see — even when already signed in — how much longer their
 * upload quota is valid for.
 *
 * Formatting is a pure function of a fetched status + the chain's block
 * time (ms per block), so it is trivially unit-testable without touching
 * the chain client.
 */

import { Enum } from "polkadot-api";
import type { PaseoClient } from "../connection.js";
import { remainingAuthorizationExtent } from "./authorizationExtent.js";

const AT_BEST = { at: "best" as const };

export interface AttestationStatus {
    authorized: boolean;
    expired: boolean;
    /** 0 if unauthorized or expired. */
    remainingBlocks: number;
    /** Absolute block number at which the authorization expires. */
    expiresAt: number | undefined;
    remainingTxs: number | undefined;
    remainingBytes: bigint | undefined;
}

export async function checkAttestation(
    client: PaseoClient,
    address: string,
): Promise<AttestationStatus> {
    const [raw, currentBlock] = await Promise.all([
        client.bulletin.query.TransactionStorage.Authorizations.getValue(
            Enum("Account", address),
            AT_BEST,
        ),
        client.bulletin.query.System.Number.getValue(AT_BEST),
    ]);

    if (!raw) {
        return {
            authorized: false,
            expired: false,
            remainingBlocks: 0,
            expiresAt: undefined,
            remainingTxs: undefined,
            remainingBytes: undefined,
        };
    }

    const remainingBlocks = Math.max(0, raw.expiration - currentBlock);
    const remaining = remainingAuthorizationExtent(raw.extent);
    return {
        authorized: true,
        expired: remainingBlocks === 0,
        remainingBlocks,
        expiresAt: raw.expiration,
        remainingTxs: remaining.transactions,
        remainingBytes: remaining.bytes,
    };
}

/**
 * Bulletin runs on Aura — the slot duration doubles as the block time.
 * Cached for the process lifetime; chain constants don't change without
 * a runtime upgrade.
 */
let cachedBlockTimeMs: number | null = null;
export async function getBulletinBlockTimeMs(client: PaseoClient): Promise<number> {
    if (cachedBlockTimeMs !== null) return cachedBlockTimeMs;
    const ms = await client.bulletin.constants.Aura.SlotDuration();
    cachedBlockTimeMs = Number(ms);
    return cachedBlockTimeMs;
}

// ── Formatter (pure) ─────────────────────────────────────────────────────────

export type AttestationTone = "default" | "warning" | "danger" | "muted";

export interface FormattedAttestation {
    text: string;
    tone: AttestationTone;
}

/** 24 hours — below this, attestation reads in warning color. */
const WARNING_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Turn a raw attestation status + the chain's block time into the compact
 * display string shown on a Row value. No colors are chosen here — only a
 * tone, which the theme maps to its palette.
 */
export function formatAttestation(
    status: AttestationStatus,
    blockTimeMs: number,
): FormattedAttestation {
    if (!status.authorized) {
        return { text: "not attested", tone: "muted" };
    }
    if (status.expired) {
        return { text: `expired  ·  ${formatBlock(status.expiresAt!)}`, tone: "danger" };
    }
    const remainingMs = status.remainingBlocks * blockTimeMs;
    const human = humanizeDuration(remainingMs);
    const tone: AttestationTone = remainingMs < WARNING_THRESHOLD_MS ? "warning" : "default";
    return { text: `${human}  ·  ${formatBlock(status.expiresAt!)}`, tone };
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Human-readable remaining time. Quantized so "roughly how long" is never
 * more precise than it needs to be: minutes below an hour, hours below a
 * day, days with trailing hours below a month, and >30d beyond that.
 */
export function humanizeDuration(ms: number): string {
    if (ms <= 0) return "0m";
    if (ms >= 30 * MS_PER_DAY) return ">30d";

    const days = Math.floor(ms / MS_PER_DAY);
    const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR);
    const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);

    if (days >= 1) return hours > 0 ? `~${days}d ${hours}h` : `~${days}d`;
    if (hours >= 1) return minutes > 0 ? `~${hours}h ${minutes}m` : `~${hours}h`;
    return `~${minutes || 1}m`;
}

/** Block number with thousands separators, prefixed with '#'. */
function formatBlock(n: number): string {
    return `#${n.toLocaleString("en-US")}`;
}
