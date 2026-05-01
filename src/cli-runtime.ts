import { withCommandTelemetry } from "./telemetry.js";
import type { CliCommandName } from "./telemetry-config.js";
import {
    onProcessShutdown,
    scheduleHardExit,
    startMemoryWatchdog,
} from "./utils/process-guard.js";

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

    try {
        await withCommandTelemetry(name, action);
    } finally {
        try {
            stopWatchdog?.();
        } catch {
            // best-effort
        }
        if (hardExit) {
            const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
            scheduleHardExit(exitCode);
        }
    }
}
