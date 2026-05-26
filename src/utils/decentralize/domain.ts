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
 * Resolve the `.dot` label to deploy under — either the user's `--dot` (or
 * typed input from the TUI), validated for availability, or an
 * auto-generated name derived from the site URL.
 *
 * Pure logic (no React/Ink) so both the headless `dot decentralize --site=...`
 * path and the interactive `validate-domain` stage can share it.
 */

import { withSpan } from "../../telemetry.js";
import { type Env } from "../../config.js";
import { checkDomainAvailability, formatAvailability } from "../deploy/availability.js";
import { normalizeDomain } from "../deploy/playground.js";
import type { ResolvedSigner } from "../signer.js";
import { findAvailableRandomName } from "./randomName.js";

export interface ResolveDomainOptions {
    env: Env;
    /** When set, treated as the requested label/full-domain (with or without `.dot`). */
    providedDot: string | undefined | null;
    /** Source site URL — required when `providedDot` is empty (drives the auto-name). */
    siteUrl: string;
    /** Used for "already owned by you" availability detection. */
    signer: ResolvedSigner | null;
    /** Optional progress sink (TUI surfaces these as a single line). */
    onMessage?: (message: string) => void;
}

export interface ResolvedDomain {
    label: string;
    fullDomain: string;
    /** Advisory note from the availability check (e.g. PoP requirement). */
    note: string | null;
}

export async function resolveDomain(opts: ResolveDomainOptions): Promise<ResolvedDomain> {
    const { env, providedDot, siteUrl, signer, onMessage } = opts;

    if (providedDot) {
        const normalized = normalizeDomain(providedDot);
        onMessage?.(`\n▸ Checking ${normalized.fullDomain}…`);
        const availability = await withSpan(
            "cli.decentralize.availability",
            "check domain availability",
            () =>
                checkDomainAvailability(normalized.label, {
                    env,
                    ownerSs58Address: signer?.address,
                }),
        );
        if (availability.status === "reserved" || availability.status === "taken") {
            throw new Error(formatAvailability(availability));
        }
        if (availability.status === "unknown") {
            onMessage?.(`\n⚠ ${formatAvailability(availability)} — continuing anyway.`);
        }
        const note =
            availability.status === "available" && availability.note ? availability.note : null;
        return { label: normalized.label, fullDomain: normalized.fullDomain, note };
    }

    onMessage?.(`\n▸ Picking a free .dot name from ${siteUrl}…`);
    const chosen = await withSpan(
        "cli.decentralize.random-name",
        "find available random name",
        () =>
            findAvailableRandomName({
                env,
                ownerSs58Address: signer?.address,
                siteUrl,
            }),
    );
    onMessage?.(`  → ${chosen.availability.fullDomain}`);
    return {
        label: chosen.label,
        fullDomain: chosen.availability.fullDomain,
        note: null,
    };
}
