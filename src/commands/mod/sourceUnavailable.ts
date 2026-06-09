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
 * Friendly messaging for the "this app's GitHub source is gone" case.
 *
 * The picker filters apps to those that published a `repository` URL, but the
 * URL is frozen into the app's metadata at deploy time and never re-validated
 * against live GitHub (deliberately — pre-probing the whole list would burn
 * the 60 req/hr anonymous GitHub quota). A publisher can later make that repo
 * private, delete it, or rename it, all of which GitHub reports identically as
 * a 404 — so we can't truthfully say *why* it's gone, only that it isn't
 * reachable. Both mod entry points (interactive picker + direct
 * `playground mod <domain>`) surface this gently instead of the raw download
 * 404 / "private or does not exist" line.
 */

export const SOURCE_UNAVAILABLE_TITLE = "Source unavailable";

/** Next-step suffix for the interactive picker (stays open, user picks again). */
export const PICK_ANOTHER_APP = "Pick another app below.";

/** Next-step suffix for the direct `playground mod <domain>` path. */
export const BROWSE_OTHER_APPS = "Run `playground mod` to browse other apps.";

export function sourceUnavailableBody(domain: string, nextStep: string): string {
    return (
        `${domain}'s source repository is no longer publicly available, ` +
        `so it can't be modded right now. ${nextStep}`
    );
}

/**
 * Thrown inside a StepRunner step to halt the remaining steps WITHOUT marking
 * the run as a hard failure. StepRunner duck-types the `haltAsWarning` flag
 * (the same way it reads `isWarning` on non-fatal warnings): it renders the
 * row with the yellow "warn" mark and reports `ok: false` so callers skip the
 * success-only "Next steps" footer. SetupScreen pairs this with a friendly
 * Callout describing the unavailable source.
 */
export class SourceUnavailableHalt extends Error {
    readonly haltAsWarning = true;
    constructor(message: string) {
        super(message);
        this.name = "SourceUnavailableHalt";
    }
}
