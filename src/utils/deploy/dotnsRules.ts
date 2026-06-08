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
 * Canonical DotNS label rules — the single source of truth for the CLI,
 * mirroring the on-chain `dotns` contracts (`StringUtils._isDnsLabel`,
 * `DotnsRegistrarController._validatedLabelNode`, and `PopRules`). Pure and
 * RPC-free so both the flag path and the TUI can share it, and so it stays
 * inside the `src/utils/deploy/*` SDK boundary (no React/Ink, no chain reads).
 *
 * bulletin-deploy enforces the same rules in `classifyDotnsLabel` /
 * `validateDomainLabel`, but does not re-export them from its package root
 * (its `exports` map blocks deep imports), so we reproduce them. Keep this in
 * sync if the contract rule set changes (governance threshold, PoP-tier remap,
 * length bounds).
 *
 * Rules (operate on a BARE label — no `.dot` suffix):
 *   - charset `[a-z0-9-]`, length 3..63, no leading/trailing hyphen
 *   - trailing digits MUST be exactly 0 or 2 (1 or >2 revert on-chain)
 *   - a 2-digit suffix may not be preceded by a hyphen: this matches bulletin-deploy's
 *     own deploy-time gate (`/-\d+$/`, "drop the hyphen"), which strips trailing digits
 *     to a trailing-hyphen base. We reject it up front so the user gets the error before
 *     the deploy rather than mid-flight.
 *   - base length = total length − trailing digits:
 *       <= 5            → Reserved (governance)
 *       6..8, 2 digits  → PoP Lite
 *       6..8, 0 digits  → PoP Full
 *       >= 9            → NoStatus (open to all)
 */

/** Mirror of the contract's PopStatus enum. */
export const POP_STATUS = {
    NoStatus: 0,
    Lite: 1,
    Full: 2,
    Reserved: 3,
} as const;

export type PopStatusValue = (typeof POP_STATUS)[keyof typeof POP_STATUS];

export type LabelValidation = { ok: true } | { ok: false; reason: string };

const MIN_LABEL_LEN = 3;
const MAX_LABEL_LEN = 63;
const LABEL_CHARSET = /^[a-z0-9-]+$/;

/** Count the trailing run of ASCII digits in a label. */
export function countTrailingDigits(label: string): number {
    let n = 0;
    for (let i = label.length - 1; i >= 0; i--) {
        const c = label[i];
        if (c >= "0" && c <= "9") n++;
        else break;
    }
    return n;
}

/**
 * Validate a bare DotNS label against the canonical contract rules. Returns a
 * non-throwing result so the TUI can render the reason and the flag path can
 * throw. Callers strip any `.dot` suffix before calling.
 */
export function validateDomainLabel(label: string): LabelValidation {
    if (label.length < MIN_LABEL_LEN) {
        return { ok: false, reason: "must be at least 3 characters" };
    }
    if (label.length > MAX_LABEL_LEN) {
        return { ok: false, reason: "must be at most 63 characters" };
    }
    if (!LABEL_CHARSET.test(label)) {
        return { ok: false, reason: "use lowercase letters, digits, and dashes only" };
    }
    if (label.startsWith("-") || label.endsWith("-")) {
        return { ok: false, reason: "cannot start or end with a dash" };
    }
    const trailingDigits = countTrailingDigits(label);
    if (trailingDigits === 1 || trailingDigits > 2) {
        return { ok: false, reason: "a digit suffix must be exactly two digits (e.g. my-app42)" };
    }
    if (trailingDigits === 2 && label[label.length - trailingDigits - 1] === "-") {
        return {
            ok: false,
            reason: "a digit suffix cannot follow a dash (use my-app42, not my-app-42)",
        };
    }
    return { ok: true };
}

/**
 * Classify a label into its PoP tier. Self-contained and robust for any input
 * (an out-of-spec digit suffix maps to Reserved), so it is safe to call even on
 * labels that have not been through `validateDomainLabel`.
 */
export function classifyLabel(label: string): { status: PopStatusValue; message: string } {
    const trailingDigits = countTrailingDigits(label);
    if (trailingDigits === 1 || trailingDigits > 2) {
        return {
            status: POP_STATUS.Reserved,
            message: `A digit suffix must be exactly two digits; "${label}" has ${trailingDigits}.`,
        };
    }
    const baseLength = label.length - trailingDigits;
    if (baseLength <= 5) {
        return {
            status: POP_STATUS.Reserved,
            message: `Base name is ${baseLength} character${baseLength === 1 ? "" : "s"}; DotNS reserves base names of 5 characters or fewer for governance.`,
        };
    }
    if (baseLength <= 8) {
        if (trailingDigits === 2) {
            return { status: POP_STATUS.Lite, message: "Requires Lite Proof of Personhood" };
        }
        return { status: POP_STATUS.Full, message: "Requires Full Proof of Personhood" };
    }
    // baseLength >= 9 → open to all, with a 0- or 2-digit suffix.
    return { status: POP_STATUS.NoStatus, message: "Available to all" };
}
