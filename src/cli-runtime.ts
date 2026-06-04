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

import { withCommandTelemetry } from "./telemetry.js";
import type { CliCommandName } from "./telemetry-config.js";
import { onProcessShutdown, scheduleHardExit, startMemoryWatchdog } from "./utils/process-guard.js";

export interface RunCliCommandOptions {
    /**
     * Start the memory watchdog and stop it on exit. Defaults to true.
     *
     * ON for every command by default because the watchdog's worker thread
     * is the ONLY guard that survives event-loop starvation: when a leaked
     * polkadot-api subscription enters the microtask-flood state (see
     * `process-guard.ts`), signal handlers, `hardExit` timers, and the
     * final `process.exit()` in `src/index.ts` all stop firing — the
     * process looks finished but sits invisible, growing tens of GB until
     * the OS swaps itself to death. We shipped exactly that: `playground
     * init` ran watchdog-less and three zombies reached 40+ GB each
     * (June 2026). Cost is one worker + a 1 Hz `memoryUsage()` sample —
     * don't opt commands out to save it.
     */
    watchdog?: boolean;
    /** Schedule a hard-exit safety net after the action returns. Defaults to true. */
    hardExit?: boolean;
}

/**
 * Wrap a Commander `.action()` body with the standard CLI scaffolding:
 *
 *   - withCommandTelemetry (root span + flush)
 *   - optional memory watchdog start/stop
 *   - optional hard-exit safety net for stray WebSockets
 *
 * Replaces the repeated `try { withCommandTelemetry(...) } finally {
 * scheduleHardExit(...) }` boilerplate at every command's top level.
 */
export async function runCliCommand(
    name: CliCommandName,
    options: RunCliCommandOptions,
    action: () => Promise<unknown>,
): Promise<void> {
    const watchdog = options.watchdog ?? true;
    const hardExit = options.hardExit ?? true;

    let stopWatchdog: (() => void) | undefined;
    if (watchdog) {
        stopWatchdog = startMemoryWatchdog();
        onProcessShutdown(stopWatchdog);
    }

    let caughtError: unknown = null;
    try {
        await withCommandTelemetry(name, action);
    } catch (err) {
        caughtError = err;
    } finally {
        try {
            stopWatchdog?.();
        } catch {
            // Defence-in-depth: stopWatchdog already swallows worker.postMessage errors
            // internally. This guards against an unexpected throw from the worker handle.
        }
        if (hardExit) {
            // Treat process.exitCode=0 as "not explicitly set" (0 is the default and
            // cannot be distinguished from "never written"). Only a non-zero value
            // written by the action is treated as an explicit override.
            const explicit =
                typeof process.exitCode === "number" && process.exitCode !== 0
                    ? process.exitCode
                    : null;
            if (explicit !== null) {
                // Caller set an explicit exit code (e.g. via inner catch).
                // Preserve it and install the hard-exit safety net.
                scheduleHardExit(explicit);
            } else if (!caughtError) {
                // Clean success path — install the safety net at exit code 0.
                scheduleHardExit(0);
            }
            // Else (uncaught error, no explicit exit code): do NOT schedule hard exit.
            // `scheduleHardExit` would pre-set process.exitCode=1, which suppresses the
            // outer error printer in `src/index.ts`. Letting the rethrow propagate
            // naturally lets index.ts print the error message AND set the exit code
            // before its own `process.exit(...)` fires. The hard-exit safety net is
            // not needed on this path because the index.ts catch is short and ends in
            // a synchronous `process.exit`.
        }
    }
    if (caughtError) throw caughtError;
}
