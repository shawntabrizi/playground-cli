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

import { test, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Guard against removing the Bun SEA-binary stdin warm-up.
 *
 * Per CLAUDE.md: Ink's `useInput` silently drops every keystroke in the
 * `bun build --compile` binary unless `process.stdin.on("readable", …)`
 * is touched before Ink's `render()`. We install a no-op `readable`
 * listener at the top of `src/index.ts` as a warm-up.
 *
 * This is a SOURCE-LEVEL assertion (not behavioural). We deliberately
 * don't import `./index.js` because that triggers `installSignalHandlers`,
 * `startMemoryWatchdog`, Sentry SDK init, and other side effects that
 * make a runtime listener-count check unreliable — and a real PTY-based
 * behavioural test would require `node-pty`, which we ruled out.
 *
 * The test catches the documented regression — "someone deleted the
 * warm-up line" — and nothing finer. A change that *renames* the call
 * pattern (e.g. uses `addListener` instead of `.on`) would also fail
 * here; that's a deliberate trip-wire, not a flake.
 *
 * Caveat: the lookbehind only excludes `//` line comments. A block comment
 * (slash-star … star-slash) containing the same pattern would defeat the
 * trip-wire. No such comment exists in src/index.ts today; if one is added
 * later, tighten this regex.
 */
test("src/index.ts contains the stdin warm-up listener", () => {
    const source = readFileSync("src/index.ts", "utf-8");
    // Use a negative lookbehind to reject occurrences that appear inside a
    // single-line comment (// …). A commented-out warm-up is the same as no
    // warm-up from Bun's runtime perspective.
    expect(source).toMatch(/(?<!\/\/.*)process\.stdin\.on\(\s*["']readable["']/m);
});
