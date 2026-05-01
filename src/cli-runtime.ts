import { withCommandTelemetry } from "./telemetry.js";
import type { CliCommandName } from "./telemetry-config.js";
import { onProcessShutdown, scheduleHardExit, startMemoryWatchdog } from "./utils/process-guard.js";

export interface RunCliCommandOptions {
    /** Start the memory watchdog and stop it on exit. Defaults to false. */
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
    const watchdog = options.watchdog ?? false;
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
            const fallback = caughtError ? 1 : 0;
            scheduleHardExit(explicit ?? fallback);
        }
    }
    if (caughtError) throw caughtError;
}
