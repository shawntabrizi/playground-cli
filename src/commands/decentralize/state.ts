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
 * Pure stage-machine + helpers for `dot decentralize`'s interactive TUI.
 *
 * Lives in a `.ts` (not `.tsx`) so tests can exercise the prompt ordering
 * without importing Ink / React. Mirrors the layout convention used by
 * `init/completion.ts`, `init/identityLine.ts`, etc.
 */

import { validateDomainLabel } from "../../utils/deploy/dotnsRules.js";
import type { DecentralizeOutcome } from "../../utils/decentralize/run.js";
import type { SignerMode } from "../../utils/deploy/signerMode.js";

export type Stage =
    | { kind: "prompt-url" }
    | { kind: "prompt-signer" }
    | { kind: "prompt-domain" }
    | { kind: "validate-domain"; raw: string }
    | { kind: "prompt-publish" }
    | { kind: "confirm" }
    | { kind: "running" }
    | { kind: "done"; outcome: DecentralizeOutcome }
    | { kind: "error"; message: string };

export interface PickStageInput {
    siteUrl: string | null;
    /**
     * `null` when neither --suri nor a session signer has resolved one yet
     * AND the user hasn't picked a mode in the TUI. `"phone" | "dev"` once a
     * choice is locked in.
     */
    signerMode: SignerMode | null;
    /** Normalized `.dot` label (without `.dot`) once the validate step has accepted it. */
    domainLabel: string | null;
    /** Raw user input from the domain prompt. `null` if the prompt hasn't happened yet. */
    domainRaw: string | null;
    /**
     * Whether to publish to the playground registry after the storage upload.
     * `null` ⇒ user hasn't answered the prompt yet; `true`/`false` locks the
     * choice and unblocks the confirm stage. Pre-set when the caller passed
     * `--playground` so the prompt is skipped.
     */
    publishToPlayground: boolean | null;
}

/**
 * Decide which prompt stage to show next given the inputs collected so far.
 * URL → signer → domain → validate-domain → publish? → confirm. Each missing
 * piece surfaces its prompt; once everything is filled the `confirm` stage
 * gates the actual run.
 *
 * `domainRaw` exists so the screen can distinguish "user hasn't been
 * asked yet" from "user typed input but validation hasn't finished".
 */
export function pickNextStage(input: PickStageInput): Stage {
    if (input.siteUrl === null) return { kind: "prompt-url" };
    if (input.signerMode === null) return { kind: "prompt-signer" };
    if (input.domainLabel === null) {
        if (input.domainRaw === null) return { kind: "prompt-domain" };
        return { kind: "validate-domain", raw: input.domainRaw };
    }
    if (input.publishToPlayground === null) return { kind: "prompt-publish" };
    return { kind: "confirm" };
}

/**
 * Allow callers to validate a typed site URL before submission. Matches
 * `mirror.ts`'s tolerance: bare hostnames (`example.com`) are accepted —
 * `mirrorSite` will prepend `https://` itself — but anything with a
 * non-http(s) scheme is rejected up front.
 *
 * Returns `null` when the input is acceptable, an error message otherwise.
 */
export function validateSiteUrlInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return "enter a URL";
    if (/^https?:\/\//i.test(trimmed)) return null;
    if (/^[a-z]+:\/\//i.test(trimmed)) return "only http(s) URLs are supported";
    // Bare hostname — mirror.ts will normalise it.
    if (/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(\/.*)?$/i.test(trimmed)) return null;
    return "doesn't look like a URL";
}

/**
 * Inline TUI gate for the domain prompt. Delegates to the canonical DotNS
 * `validateDomainLabel` (same rules as `dot deploy` and `normalizeDomain`),
 * tolerating an optional `.dot` suffix. Availability + reservation are decided
 * by the chain in the validate-domain stage; this just rejects labels the
 * chain would reject so the user sees the error inline rather than after submit.
 */
export function validateDomainInput(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null; // empty = "auto-generate from URL"
    const label = trimmed.replace(/\.dot$/i, "");
    const result = validateDomainLabel(label);
    return result.ok ? null : result.reason;
}
