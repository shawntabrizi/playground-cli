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

// Env-var wiring that MUST be applied before any `bulletin-deploy` module
// evaluates. ES-module top-level evaluation is dependency-first + ordered
// across siblings of the same parent, so importing this module as the very
// first statement in `src/index.ts` guarantees its side effects run before
// bulletin-deploy initialises its telemetry gates. Plain `process.env.X`
// assignments later in `index.ts` are too late because import hoisting would
// have already evaluated the bulletin-deploy import chain.
//
// The CLI owns the Sentry SDK and hands the active client to bulletin-deploy
// through ambient mode. `DOT_TELEMETRY` remains the privacy gate for both apps:
// unknown external users stay off by default, while known internal contexts
// and explicit `DOT_TELEMETRY=1` opt in. Do not set
// `BULLETIN_DEPLOY_HOST_APP=playground-cli` without also setting an explicit
// `BULLETIN_DEPLOY_TELEMETRY` value; bulletin-deploy treats this host app as
// internal.

import { configure as configureProductSdkLogger } from "@parity/product-sdk-logger";
import { configureBulletinTelemetryEnv } from "./telemetry-config.js";

// Forces ESM module semantics on this otherwise-import-free file. Without it,
// TS classifies the file as a script and `await import("./bootstrap.js")`
// resolves to `{ default: undefined }` with no export binding — TS2306 at
// every callsite in `bootstrap.test.ts`. Keep.
export {};

configureBulletinTelemetryEnv();

// ── stderr filter for post-destroy DestroyedError ──────────────────────────
//
// polkadot-api's chain-head subscriptions emit `DestroyedError: Client
// destroyed` from detached microtasks during teardown (when the WS provider
// disconnects, every in-flight `chainHead_v1_*` subscription tries to send a
// cancel RPC and the lazy client has already been disposed). Those rejections
// are NOT tied to a promise we hold — they're scheduled internally by
// polkadot-api and surface as unhandled rejections at process drain.
//
// We can't attach `.catch()` because we don't own the promises, and
// `process.on('unhandledRejection')` only stops OUR additional stderr write —
// Bun's compiled SEA prints the rejection via its built-in formatter
// regardless of registered handlers. The only effective silence is to filter
// the formatter's output at the stderr boundary.
//
// The filter matches Bun's specific block shape:
//   "This error originated either by throwing inside of an async function ..."
//   "DestroyedError: Client destroyed"
//   "    at ..." (stack frames)
// We drop whole writes whose payload contains both the preamble AND the
// "DestroyedError: Client destroyed" line. Everything else passes through
// untouched so genuine errors stay visible. Set `DOT_DEPLOY_VERBOSE=1` to
// route the suppressed block through to a `(suppressed)` marker for debugging.
//
// Drop this once Bun's SEA respects `process.on('unhandledRejection')`
// suppression or once polkadot-api's chain-head teardown stops emitting
// detached rejections.
{
    const origWrite = process.stderr.write.bind(process.stderr);
    const BUN_UNHANDLED_PREAMBLE =
        "This error originated either by throwing inside of an async function";
    const BENIGN_ERROR = "DestroyedError: Client destroyed";

    function isBenignDestroyedRejection(text: string): boolean {
        return text.includes(BUN_UNHANDLED_PREAMBLE) && text.includes(BENIGN_ERROR);
    }

    function toText(chunk: unknown): string {
        if (typeof chunk === "string") return chunk;
        if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString("utf8");
        return "";
    }

    process.stderr.write = function patchedWrite(
        chunk: string | Uint8Array,
        encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
        cb?: (err?: Error | null) => void,
    ): boolean {
        if (isBenignDestroyedRejection(toText(chunk))) {
            if (process.env.DOT_DEPLOY_VERBOSE === "1") {
                origWrite("(suppressed benign DestroyedError post-teardown)\n");
            }
            const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
            callback?.();
            return true;
        }
        // Forward verbatim; cast through unknown so we don't have to spell out
        // every overload of stream.write.
        return (origWrite as unknown as (...args: unknown[]) => boolean)(chunk, encodingOrCb, cb);
    } as typeof process.stderr.write;
}

/**
 * Route product-sdk log output through our own handler so we can suppress
 * specific entries that are known-benign artifacts of teardown but corrupt
 * Ink's screen when they hit stderr mid-render.
 *
 * Known-benign entries:
 *   - `tx`: "Transaction subscription error" with `error.message === "Client destroyed"`
 *     — fires after `submitAndWatch` resolves and the adapter is torn down by
 *     React `useEffect` cleanup. The tx itself either succeeded or failed
 *     with a real error we already surfaced via the rejection path; this
 *     stale subscription event is purely noise.
 *
 * Everything else passes through to the default console sink so genuine
 * SDK errors stay visible. Set `DOT_DEPLOY_VERBOSE=1` to see suppressed
 * entries (helpful when chasing a regression in the suppression filter).
 */
configureProductSdkLogger({
    level: "warn",
    handler: (entry) => {
        const isBenignDestroyedDuringTx =
            entry.namespace === "tx" &&
            entry.message === "Transaction subscription error" &&
            typeof entry.data === "object" &&
            entry.data !== null &&
            /client destroyed/i.test(String((entry.data as { error?: unknown }).error ?? ""));
        if (isBenignDestroyedDuringTx) {
            if (process.env.DOT_DEPLOY_VERBOSE === "1") {
                process.stderr.write(
                    `(suppressed product-sdk-logger: ${entry.namespace}/${entry.message})\n`,
                );
            }
            return;
        }
        // Default sink shape: `[ns] message data?`
        const prefix = `[${entry.namespace}] ${entry.message}`;
        const tail = entry.data === undefined ? "" : ` ${JSON.stringify(entry.data)}`;
        if (entry.level === "error" || entry.level === "warn") {
            process.stderr.write(`${prefix}${tail}\n`);
        } else {
            process.stdout.write(`${prefix}${tail}\n`);
        }
    },
});
