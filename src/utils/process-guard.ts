/**
 * Defense-in-depth against runaway memory / zombie processes.
 *
 * The deploy pipeline opens several long-lived WebSockets (session adapter,
 * Paseo client, bulletin-deploy's own clients, our dedicated metadata client)
 * plus child processes for the build step. If any of these survive beyond the
 * deploy's normal exit — because a subscription wasn't unref'd, a retry loop
 * got stuck, or the user force-quit their terminal mid-deploy — the process
 * becomes a zombie that keeps accumulating buffers from every retry.
 *
 * We've observed that zombie climb past 25 GB on a 16 GB machine, which means
 * the OS starts swapping and the whole laptop freezes. These guards try
 * very hard to make that impossible:
 *
 *   1. `installSignalHandlers()` catches SIGINT / SIGTERM / SIGHUP and forces
 *      cleanup + hard exit within 3 s, regardless of what else is keeping the
 *      event loop alive.
 *
 *   2. `scheduleHardExit()` installs a final safety net: once the command's
 *      main async flow returns, if the process hasn't exited naturally within
 *      a short grace period we exit anyway.
 *
 *   3. `startMemoryWatchdog()` samples `process.memoryUsage().rss` every few
 *      seconds. If it crosses a hard cap the process aborts with a loud
 *      error message rather than taking the user's machine down.
 */

/**
 * Maximum RSS we're willing to tolerate before aborting the deploy. A
 * legitimate deploy loads polkadot-api runtime metadata for three chains,
 * holds the app CAR bytes + chunk buffers in memory, runs Ink + yoga WASM
 * on top of Bun's compiled-binary JSC heap. On Apple Silicon with a Bun SEA
 * binary, a happy-path deploy routinely touches ~1–1.5 GB just from
 * baseline + metadata loading. We keep the absolute cap generous so we
 * don't false-abort on a legit spike; any leak worthy of the name will
 * climb past this quickly enough.
 */
const MEMORY_LIMIT_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB

/** How often the watchdog samples memory. */
const MEMORY_POLL_MS = 5000;

/** Grace period after the main flow returns before we force-exit. */
const HARD_EXIT_GRACE_MS = 2000;

export type CleanupHook = () => void | Promise<void>;

const cleanupHooks: CleanupHook[] = [];
let signalHandlersInstalled = false;

/** Register a best-effort cleanup callback that fires on SIGINT/TERM/HUP. */
export function onProcessShutdown(hook: CleanupHook): void {
    cleanupHooks.push(hook);
}

/**
 * Install process-level signal handlers. Must be called early — before any
 * long-lived resources are allocated.
 */
export function installSignalHandlers(): void {
    if (signalHandlersInstalled) return;
    signalHandlersInstalled = true;

    const terminate = (signal: NodeJS.Signals) => {
        process.stderr.write(`\n${signal} received — tearing down and exiting.\n`);
        runAllCleanupAndExit(signal === "SIGINT" ? 130 : 143);
    };

    process.on("SIGINT", () => terminate("SIGINT"));
    process.on("SIGTERM", () => terminate("SIGTERM"));
    process.on("SIGHUP", () => terminate("SIGHUP"));

    // Unhandled rejections should not silently keep the event loop alive.
    process.on("unhandledRejection", (reason) => {
        process.stderr.write(`\nUnhandled promise rejection: ${String(reason)}\n`);
        runAllCleanupAndExit(1);
    });
}

/**
 * Schedule a hard-exit safety net: let the event loop drain naturally, but
 * if a stray WebSocket / subscription keeps it alive past a short grace
 * period, force-exit. The timer is `unref()`'d so a clean drain still
 * exits the process at its natural time.
 */
export function scheduleHardExit(exitCode: number): void {
    process.exitCode = exitCode;
    const timer = setTimeout(() => {
        // Something is still ref'ing the loop — take the process down before
        // it grows into a multi-GB zombie. The message hints to users why.
        process.stderr.write(
            "\n(forcing exit — a WebSocket or subscription refused to close cleanly)\n",
        );
        process.exit(exitCode);
    }, HARD_EXIT_GRACE_MS);
    // Don't hold the event loop open ourselves — if everything else releases,
    // Node exits naturally with `process.exitCode`.
    timer.unref();
}

/**
 * Poll RSS and abort if we blow past the absolute limit. Returns a `stop()`
 * that cancels the watchdog — call it from a `finally` block.
 *
 * When `DOT_MEMORY_TRACE=1` is set we also log every sample to stderr so a
 * user hitting a leak can attach the timeline to a bug report without
 * needing a heap snapshot.
 */
export function startMemoryWatchdog(): () => void {
    const trace = process.env.DOT_MEMORY_TRACE === "1";
    const started = Date.now();
    let peak = 0;

    const interval = setInterval(() => {
        const mem = process.memoryUsage();
        const rss = mem.rss;
        if (rss > peak) peak = rss;

        if (trace) {
            const elapsed = ((Date.now() - started) / 1000).toFixed(1);
            process.stderr.write(
                `[mem +${elapsed}s] rss=${formatBytes(rss)} ` +
                    `heap=${formatBytes(mem.heapUsed)}/${formatBytes(mem.heapTotal)} ` +
                    `external=${formatBytes(mem.external)} ` +
                    `peak=${formatBytes(peak)}\n`,
            );
        }

        if (rss > MEMORY_LIMIT_BYTES) {
            process.stderr.write(
                `\n✖ Memory use exceeded ${formatBytes(MEMORY_LIMIT_BYTES)} ` +
                    `(RSS ≈ ${formatBytes(rss)}). Aborting to protect your machine.\n` +
                    `This is almost certainly a leaked subscription or runaway ` +
                    `retry loop. To diagnose, re-run with DOT_MEMORY_TRACE=1.\n`,
            );
            runAllCleanupAndExit(137);
        }
    }, MEMORY_POLL_MS);
    // Don't let the watchdog itself keep the event loop alive.
    interval.unref();
    return () => clearInterval(interval);
}

async function runAllCleanupAndExit(code: number): Promise<never> {
    // Fire the hard-exit fallback FIRST, so a cleanup hook that hangs can't
    // block us from exiting. The fallback's timer is NOT unref'd here —
    // we *want* it to fire.
    const fallback = setTimeout(() => process.exit(code), 3000);
    try {
        for (const hook of cleanupHooks) {
            try {
                await hook();
            } catch {
                // Best-effort: don't let one bad hook block the others.
            }
        }
    } finally {
        clearTimeout(fallback);
        process.exit(code);
    }
    // `process.exit` never returns; the `never` return type is for TS.
    throw new Error("unreachable");
}

function formatBytes(n: number): string {
    if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(2)} KB`;
    return `${n} B`;
}
