import { withSpan, errorMessage } from "../../telemetry.js";
import type { TelemetryAttribute } from "../../telemetry-config.js";
import type { DeployEvent, DeployPhase } from "./run.js";

/**
 * Wrap one phase of the deploy pipeline. Emits `phase-start` before the
 * span, runs `fn` inside `withSpan` for telemetry, emits `phase-complete`
 * on success or an `error` event on failure. Always rethrows on failure
 * so callers can keep their existing control flow.
 *
 * The `phase` string is used both as the event's `phase` field and as the
 * Sentry span's `name`. Older call sites in `run.ts` used richer descriptions
 * for the span name (e.g. "build project") — that information is intentionally
 * dropped in favour of stable, dashboard-queryable phase identifiers.
 *
 * The emitted `error` event's `message` is the raw error text (consumed by
 * local TUI / RevX renderers). The Sentry-bound copy is sanitized
 * inside `withSpan`'s catch path.
 */
export async function withDeployPhase<T>(
    phase: DeployPhase,
    op: string,
    attributes: Record<string, TelemetryAttribute>,
    emit: (event: DeployEvent) => void,
    fn: () => Promise<T>,
): Promise<T> {
    emit({ kind: "phase-start", phase });
    try {
        const result = await withSpan(op, phase, attributes, fn);
        emit({ kind: "phase-complete", phase });
        return result;
    } catch (err) {
        emit({ kind: "error", phase, message: errorMessage(err) });
        throw err;
    }
}
