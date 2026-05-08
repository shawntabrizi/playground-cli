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
 *   3. `startMemoryWatchdog()` samples `process.memoryUsage().rss` from a
 *      dedicated worker thread. The worker has its own event loop, so a
 *      microtask flood on the main thread (polkadot-api subscriptions firing
 *      `.andThen(...)` chains faster than the queue drains) cannot starve
 *      the sampler. An earlier `setInterval`-on-main-thread version was seen
 *      to miss every sample while RSS climbed to 20 GB before macOS jetsam
 *      delivered SIGKILL — giving the user a mystery "zsh: killed" instead
 *      of our abort message. If the cap is crossed, the worker sends SIGKILL
 *      to the containing process (its `process.pid` IS the main PID in
 *      `worker_threads`). SIGKILL skips cleanup hooks, which is fine: at
 *      this point the event loop is already starved and signal handlers
 *      wouldn't fire anyway.
 */

import { Worker } from "node:worker_threads";

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

/**
 * How often the worker samples memory. 1 s is cheap now that sampling is
 * off the main thread — earlier 5 s main-thread sampling gave a leak ~15 s
 * of headroom to grow into GB territory before the first missed sample.
 */
const MEMORY_POLL_MS = 1000;

/** Grace period after the main flow returns before we force-exit. */
const HARD_EXIT_GRACE_MS = 2000;

export type CleanupHook = () => void | Promise<void>;

const cleanupHooks: CleanupHook[] = [];
let signalHandlersInstalled = false;
let processGuardWarningHandler:
    | ((message: string, context?: Record<string, unknown>) => void)
    | undefined;

export function setProcessGuardWarningHandler(
    handler: ((message: string, context?: Record<string, unknown>) => void) | undefined,
): void {
    processGuardWarningHandler = handler;
}

function warnProcessGuard(message: string, context?: Record<string, unknown>): void {
    try {
        processGuardWarningHandler?.(message, context);
    } catch {
        // Telemetry must never interfere with shutdown.
    }
}

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
        if (isBenignUnsubscriptionError(reason)) {
            logSuppressedBenign(reason);
            return;
        }
        process.stderr.write(`\nUnhandled promise rejection: ${String(reason)}\n`);
        runAllCleanupAndExit(1);
    });

    // Mirror the same filter for sync uncaught exceptions. polkadot-api's
    // `client.destroy()` schedules subscription teardown that can surface as
    // either an `unhandledRejection` or an `uncaughtException` depending on
    // whether the finalizer throws from a microtask or a sync path — handling
    // both removes the "naked stack trace" the user sees today right under
    // `Required status: ProofOfPersonhoodFull`.
    process.on("uncaughtException", (err) => {
        if (isBenignUnsubscriptionError(err)) {
            logSuppressedBenign(err);
            return;
        }
        process.stderr.write(`\nUncaught exception: ${err?.stack ?? String(err)}\n`);
        runAllCleanupAndExit(1);
    });
}

/**
 * When DOT_DEPLOY_VERBOSE=1, mirror a one-line note to stderr identifying
 * the actual error shape that was suppressed. Otherwise silent — the user's
 * work succeeded and a scary stack trace on the way out would be misleading.
 *
 * Telemetry hook for "benign teardown happened" deliberately skipped here
 * because `captureWarning` marks the run as `cli.sad=true`, which would
 * misclassify a successful deploy. Add a breadcrumb-only telemetry helper
 * upstream first, then wire it in.
 */
function logSuppressedBenign(reason: unknown): void {
    if (process.env.DOT_DEPLOY_VERBOSE !== "1") return;
    const name = reason instanceof Error ? reason.name : "unknown";
    const message = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write(`(suppressed benign post-destroy ${name}: ${message})\n`);
}

/**
 * True for the specific rxjs / polkadot-api errors we see on `client.destroy()`
 * when a still-live chainHead (or similar) subscription's teardown tries to
 * send a cancel RPC after the chainHead follow has already been disjointed or
 * the WS closed — by design, because we just destroyed the client. Three shapes
 * surface in practice:
 *
 *   1. `UnsubscriptionError` wrapping inner `Not connected` errors (rxjs).
 *   2. `DisjointError: ChainHead disjointed` from polkadot-api's substrate
 *      client when an outstanding chainHead operation races the unfollow.
 *   3. `DestroyedError: Client destroyed` from `@polkadot-api/raw-client`'s
 *      `disconnect()` (`responses.forEach(r => r.onError(new DestroyedError()))`),
 *      surfaced during `dot logout` when `@parity/product-sdk-terminal::destroy()`
 *      tears down the polkadot-api client while a statement-store subscription
 *      still has an in-flight RPC. This shape is exclusive to PAPI raw-client
 *      teardown, so matching the bare error class is safe.
 *
 * All three look terrifying but are already the expected outcome. Keeping the
 * match narrow so a genuinely new failure still escalates.
 */
export function isBenignUnsubscriptionError(reason: unknown): boolean {
    if (!(reason instanceof Error)) return false;
    if (reason.name === "DisjointError") return true;
    if (reason.name === "DestroyedError") return true;
    if (reason.name !== "UnsubscriptionError") return false;
    const errors = (reason as Error & { errors?: unknown }).errors;
    if (!Array.isArray(errors) || errors.length === 0) return false;
    return errors.every((e) => {
        const msg = e instanceof Error ? e.message : typeof e === "string" ? e : String(e ?? "");
        return /not connected/i.test(msg);
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
 * Worker-thread body. Sampled as source: `new Worker(WORKER_CODE, { eval: true })`.
 *
 * Runs in its own V8 isolate + event loop, so the main thread's microtask
 * pressure cannot delay these samples. `process.memoryUsage()` returns
 * process-wide stats (the worker shares the same OS process), so RSS here
 * is the full `dot` process's RSS.
 *
 * If the cap is crossed we SIGKILL `process.pid` — which is the containing
 * process's PID in a worker — and both threads die. We deliberately don't
 * try to run cleanup: if the event loop is starved enough to hit 4 GB,
 * cleanup hooks won't fire on the main thread anyway, and leaving the
 * machine swappy is the worse failure mode.
 */
const WATCHDOG_WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const { limit, pollMs, trace } = workerData;

const fmt = (n) => {
  if (n >= 1024 ** 3) return (n / (1024 ** 3)).toFixed(2) + ' GB';
  if (n >= 1024 ** 2) return (n / (1024 ** 2)).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(2) + ' KB';
  return n + ' B';
};

// Use fs.writeSync(2, ...) for the abort message instead of
// process.stderr.write(): when stderr is redirected to a pipe (e.g.
// '2> dot-stderr.log'), Node buffers writes through its stream layer.
// Issuing SIGKILL immediately after process.stderr.write() can drop the
// last-message buffer before it reaches the file. fs.writeSync is a
// blocking write(2) syscall and completes before we kill ourselves.
const writeStderr = (s) => {
  try { fs.writeSync(2, s); } catch (_) { /* best-effort */ }
};

const started = Date.now();
let peak = 0;

const interval = setInterval(() => {
  const mem = process.memoryUsage();
  if (mem.rss > peak) peak = mem.rss;

  if (trace) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    writeStderr(
      '[mem +' + elapsed + 's] rss=' + fmt(mem.rss) +
      ' heap=' + fmt(mem.heapUsed) + '/' + fmt(mem.heapTotal) +
      ' external=' + fmt(mem.external) +
      ' peak=' + fmt(peak) + '\\n'
    );
  }

  if (mem.rss > limit) {
    writeStderr(
      '\\n\\u2716 Memory use exceeded ' + fmt(limit) +
      ' (RSS \\u2248 ' + fmt(mem.rss) + '). Watchdog killing process.\\n' +
      'This is almost certainly a leaked subscription or runaway retry loop. ' +
      'Re-run with DOT_MEMORY_TRACE=1 DOT_DEPLOY_VERBOSE=1 to capture the timeline.\\n'
    );
    // SIGKILL the whole process. process.pid from a worker is the host
    // process PID, so this takes down the main thread too.
    process.kill(process.pid, 'SIGKILL');
  }
}, pollMs);

parentPort.on('message', (msg) => {
  if (msg === 'stop') {
    clearInterval(interval);
    process.exit(0);
  }
});
`;

/**
 * Start the memory watchdog in a dedicated worker thread. Returns a `stop()`
 * that tears the worker down — call it from a `finally` block.
 *
 * When `DOT_MEMORY_TRACE=1` is set we stream every sample to stderr so a
 * user hitting a leak can attach the timeline to a bug report without
 * needing a heap snapshot.
 */
export function startMemoryWatchdog(): () => void {
    const trace = process.env.DOT_MEMORY_TRACE === "1";
    const worker = new Worker(WATCHDOG_WORKER_SOURCE, {
        eval: true,
        workerData: {
            limit: MEMORY_LIMIT_BYTES,
            pollMs: MEMORY_POLL_MS,
            trace,
        },
    });
    // Don't let the worker itself keep the host process alive on a clean
    // exit — postMessage('stop') on shutdown handles the happy path.
    worker.unref();

    let stopped = false;
    return () => {
        if (stopped) return;
        stopped = true;
        try {
            worker.postMessage("stop");
        } catch {
            // Worker may already be gone (e.g. it triggered SIGKILL on itself);
            // fall through to the defensive terminate below.
        }
        // Defense in depth: if the worker hangs on shutdown for any reason,
        // force-terminate it so it can't keep the process alive.
        const killTimer = setTimeout(() => {
            worker.terminate().catch(() => {
                /* best-effort */
            });
        }, 500);
        killTimer.unref();
    };
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
            } catch (err) {
                warnProcessGuard("Process cleanup hook failed", {
                    error:
                        err instanceof Error
                            ? err.message.slice(0, 200)
                            : String(err).slice(0, 200),
                });
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
