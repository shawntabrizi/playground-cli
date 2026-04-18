/**
 * Wraps a `PolkadotSigner` so the TUI can render a "check your phone" panel
 * around each signing call. We cannot infer this from bulletin-deploy's
 * stdout (the log is printed before the signer is invoked and gives no
 * completion hook), so the reliable place to hook is the signer itself.
 */

import type { PolkadotSigner } from "polkadot-api";

export type SigningEvent =
    | { kind: "sign-request"; label: string; step: number; total: number }
    | { kind: "sign-complete"; label: string; step: number; total: number }
    | { kind: "sign-error"; label: string; step: number; total: number; message: string };

export interface SigningCounter {
    /** Reserve the next step number. Returns { step, total } for the event payload. */
    next(): { step: number; total: number };
    /** How many steps were reserved so far — useful for a final tally. */
    count(): number;
}

export function createSigningCounter(total: number): SigningCounter {
    let step = 0;
    // Treat the caller's `total` as a *minimum* — if the real deploy fires
    // more sigs than we predicted (e.g. bulletin-deploy adds a new DotNS tx
    // in a future version, or our PoP upgrade detection missed a case), the
    // UI shows "step N of N" rather than the obviously-wrong "step N of N-1".
    // Summary card's pre-deploy count can still be stale; this only fixes
    // the runtime counter.
    let runningTotal = total;
    return {
        next() {
            step += 1;
            if (step > runningTotal) runningTotal = step;
            return { step, total: runningTotal };
        },
        count() {
            return step;
        },
    };
}

export interface WrapOptions {
    /** Human-readable label that names what the user is approving (shown on-screen). */
    label: string;
    /** Step counter shared across a whole deploy run so "2 of 4" counts correctly. */
    counter: SigningCounter;
    /** Sink for the signing lifecycle events. */
    onEvent: (event: SigningEvent) => void;
}

/**
 * Returns a new `PolkadotSigner` that mirrors `inner` but emits lifecycle
 * events around each signing call. The wrapper does NOT swallow errors — the
 * original rejection still propagates — it only surfaces them to `onEvent`
 * so the TUI can render a red banner.
 */
export function wrapSignerWithEvents(inner: PolkadotSigner, options: WrapOptions): PolkadotSigner {
    const announce = async <T>(fn: () => Promise<T>): Promise<T> => {
        const { step, total } = options.counter.next();
        options.onEvent({ kind: "sign-request", label: options.label, step, total });
        try {
            const value = await fn();
            options.onEvent({ kind: "sign-complete", label: options.label, step, total });
            return value;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            options.onEvent({ kind: "sign-error", label: options.label, step, total, message });
            throw err;
        }
    };

    return {
        publicKey: inner.publicKey,
        signTx: (callData, signedExtensions, metadata, atBlockNumber, hasher) =>
            announce(() =>
                inner.signTx(callData, signedExtensions, metadata, atBlockNumber, hasher),
            ),
        signBytes: (data) => announce(() => inner.signBytes(data)),
    };
}
