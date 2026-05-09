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
 * Line-level parser that turns bulletin-deploy's banner/prose output into a
 * typed event stream the TUI can render. Best-effort — we use it only for
 * the phases that aren't signature-gated (chunk upload progress, etc.).
 *
 * Remove once bulletin-deploy exposes a first-class `onProgress` callback.
 */

export type DeployPhase =
    | "preflight"
    | "storage"
    | "dotns"
    | "registry"
    | "playground"
    | "complete";

export type DeployLogEvent =
    | { kind: "phase-start"; phase: DeployPhase }
    | { kind: "chunk-progress"; current: number; total: number }
    | { kind: "info"; message: string };

/** Map the human-readable banner titles bulletin-deploy prints to our phase keys. */
const PHASE_BANNERS: Array<{ pattern: RegExp; phase: DeployPhase }> = [
    { pattern: /^preflight$/i, phase: "preflight" },
    { pattern: /^storage$/i, phase: "storage" },
    { pattern: /^dotns$/i, phase: "dotns" },
    { pattern: /^registry$/i, phase: "registry" },
    { pattern: /^playground$/i, phase: "playground" },
    { pattern: /^deployment complete!?$/i, phase: "complete" },
];

const BANNER_DIVIDER = /^=+$/;
const CHUNK_RE = /^\s*\[(\d+)\/(\d+)\]/;

/**
 * Stateful parser: bulletin-deploy's banner is three lines
 *
 *     ============================================================
 *     Storage
 *     ============================================================
 *
 * so we need to remember that we just saw a divider to correctly pair it with
 * the next non-divider line.
 */
export class DeployLogParser {
    private expectingBannerTitle = false;

    feed(rawLine: string): DeployLogEvent | null {
        const line = rawLine.replace(/\r/g, "").trimEnd();
        const trimmed = line.trim();

        if (BANNER_DIVIDER.test(trimmed)) {
            // A divider means the next non-divider line *could* be a title.
            // We just assert the flag rather than toggle — consecutive
            // dividers (closing of one banner + opening of the next) keep
            // `expectingBannerTitle` true so the title still registers.
            this.expectingBannerTitle = true;
            return null;
        }

        if (this.expectingBannerTitle && trimmed.length > 0) {
            this.expectingBannerTitle = false;
            const match = PHASE_BANNERS.find((p) => p.pattern.test(trimmed));
            if (match) {
                return { kind: "phase-start", phase: match.phase };
            }
            // Unknown banner title — drop. Earlier we emitted `info` here as
            // a forward-compat hook; that violated the "no event per log line"
            // invariant documented in CLAUDE.md and left a loophole where a
            // single banner with a typo could open the info firehose. New
            // phases bulletin-deploy adds can be matched by extending
            // `PHASE_BANNERS`.
            return null;
        }

        const chunkMatch = trimmed.match(CHUNK_RE);
        if (chunkMatch) {
            return {
                kind: "chunk-progress",
                current: Number(chunkMatch[1]),
                total: Number(chunkMatch[2]),
            };
        }

        // Everything else is quiet prose from bulletin-deploy (CID echoes,
        // nonce traces, per-chunk success lines, etc). We intentionally DROP
        // it rather than emit `info` events: the upload path produces
        // hundreds of such lines and every one of them allocated an event
        // object + traversed our orchestrator -> TUI pipeline, which was a
        // measurable contributor to heap pressure during long deploys. The
        // TUI already shows chunk progress from the parsed events above;
        // users don't need the raw log stream in the Ink panel.
        return null;
    }
}
