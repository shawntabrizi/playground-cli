import { withSpan, sanitizedErrorMessage } from "../../telemetry.js";
import type { TelemetryAttribute } from "../../telemetry-config.js";
import type { DeployEvent, DeployPhase } from "./run.js";

/**
 * Wrap one phase of the deploy pipeline. Emits `phase-start` before the
 * span, runs `fn` inside `withSpan` for telemetry, emits `phase-complete`
 * on success or an `error` event on failure. Always rethrows on failure
 * so callers can keep their existing control flow.
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
        emit({ kind: "error", phase, message: sanitizedErrorMessage(err) });
        throw err;
    }
}
