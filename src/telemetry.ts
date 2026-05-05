import type * as SentryNode from "@sentry/node";
import {
    PLAYGROUND_SENTRY_DSN,
    VERSION,
    type CliCommandName,
    type TelemetryAttribute,
    getCliRootAttributes,
    resolveRunner,
    resolveRunnerType,
    resolveTelemetryEnabled,
    sanitizeAttributes,
    scrubPaths,
    truncateString,
} from "./telemetry-config.js";

type SentryModule = typeof SentryNode;
let Sentry: SentryModule | null = null;
let initStarted = false;

export function isTelemetryEnabled(): boolean {
    return resolveTelemetryEnabled();
}

function anonymousServerName(): string {
    return process.env.CI ? (process.env.RUNNER_NAME ?? "ci") : "local";
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function sanitizedErrorMessage(error: unknown): string {
    return truncateString(scrubPaths(errorMessage(error)));
}

function sanitizeExtra(
    context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
    if (!context) return context;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
        out[key] = sanitizeTelemetryValue(value);
    }
    return out;
}

function sanitizeTelemetryString(value: string): string {
    return truncateString(scrubPaths(value));
}

function sanitizeTelemetryValue(value: unknown, depth = 0): unknown {
    if (typeof value === "string") return sanitizeTelemetryString(value);
    if (depth > 6 || value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeTelemetryValue(item, depth + 1));
    }

    const record = value as Record<string, unknown>;
    for (const [key, nested] of Object.entries(record)) {
        record[key] = sanitizeTelemetryValue(nested, depth + 1);
    }
    return record;
}

export function sanitizeSentryEvent<T extends Record<string, unknown>>(event: T): T {
    const writable = event as Record<string, unknown>;
    writable["server_name"] = anonymousServerName();
    return sanitizeTelemetryValue(writable) as T;
}

export function sanitizeSentryTransaction<T extends Record<string, unknown>>(event: T): T {
    return sanitizeTelemetryValue(event) as T;
}

export function isExpectedCliError(message: string): boolean {
    return /badregistrylookup|signer.*not available|run "dot init"|account is not mapped|storage allowance is exhausted|invalid domain|already owned|reserved|insufficient balance|no github origin configured|must use a public github repository|private or does not exist|no foundry\/hardhat\/cdm project was detected|github api returned|download failed/i.test(
        message,
    );
}

export interface TelemetryInitOptions {
    /** Override the default Sentry transport. Used by tests to capture envelopes. */
    transport?: (options: unknown) => unknown;
}

export async function initTelemetry(options: TelemetryInitOptions = {}): Promise<void> {
    if (initStarted || !isTelemetryEnabled()) return;
    initStarted = true;

    try {
        Sentry = await import("@sentry/node");
    } catch {
        Sentry = null;
        return;
    }

    try {
        Sentry.init({
            dsn: process.env.SENTRY_DSN || PLAYGROUND_SENTRY_DSN,
            release: `playground-cli@${VERSION}`,
            tracesSampleRate: 1,
            environment: process.env.CI ? "ci" : "local",
            serverName: anonymousServerName(),
            beforeSend(event) {
                return sanitizeSentryEvent(
                    event as unknown as Record<string, unknown>,
                ) as unknown as typeof event;
            },
            beforeSendTransaction(event) {
                return sanitizeSentryTransaction(
                    event as unknown as Record<string, unknown>,
                ) as unknown as typeof event;
            },
            transport: options.transport as never,
        });
        Sentry.setTag("cli.tool_version", VERSION);
        Sentry.setContext("playground-cli", {
            version: VERSION,
            release: `playground-cli@${VERSION}`,
            node: process.version,
        });
    } catch {
        Sentry = null;
    }
}

function setRootTags(attributes: Record<string, TelemetryAttribute>): void {
    if (!Sentry) return;
    try {
        const tags: Record<string, string> = {
            "cli.command": String(attributes["cli.command"] ?? ""),
            "cli.source": String(attributes["cli.source"] ?? ""),
            "cli.repo": String(attributes["cli.repo"] ?? ""),
            "cli.branch": String(attributes["cli.branch"] ?? ""),
            "cli.tool_version": VERSION,
            "cli.runner_type": resolveRunnerType(),
        };
        if (attributes["cli.tag"]) tags["cli.tag"] = String(attributes["cli.tag"]);
        Sentry.setTags(tags);
    } catch {
        // Telemetry must never change CLI behavior.
    }
}

function setSpanAttribute(span: unknown, key: string, value: string | number | boolean): void {
    try {
        (
            span as { setAttribute?: (k: string, v: string | number | boolean) => void }
        ).setAttribute?.(key, value);
    } catch {
        // ignore
    }
}

function setSpanStatus(span: unknown, status: { code: number; message?: string }): void {
    try {
        (span as { setStatus?: (s: { code: number; message?: string }) => void }).setStatus?.(
            status,
        );
    } catch {
        // ignore
    }
}

function markSpanError(span: unknown, message: string, expected: boolean): void {
    setSpanAttribute(span, "cli.status", "error");
    setSpanAttribute(span, "cli.error", message);
    setSpanAttribute(span, "cli.expected", expected ? "true" : "false");
    setSpanAttribute(span, "cli.sad", "true");
    if (!expected) {
        setSpanStatus(span, { code: 2, message: "internal_error" });
    }
}

export async function withRootSpan<T>(
    op: string,
    name: string,
    attributes: Record<string, TelemetryAttribute>,
    fn: () => Promise<T> | T,
): Promise<T> {
    try {
        if (!Sentry) return await fn();
        const attrs = sanitizeAttributes(attributes);
        setRootTags(attrs);
        return await Sentry.startSpan({ op, name, attributes: attrs }, async (span) => {
            try {
                return await fn();
            } catch (error) {
                const msg = truncateString(scrubPaths(errorMessage(error)));
                const expected = isExpectedCliError(msg);
                markSpanError(span, msg, expected);
                if (!expected) {
                    captureException(error, { "cli.error": msg });
                }
                throw error;
            }
        });
    } finally {
        await flushTelemetry();
    }
}

export async function withCommandTelemetry<T>(
    command: CliCommandName,
    fn: () => Promise<T> | T,
): Promise<T> {
    return withRootSpan(`cli.${command}`, `dot ${command}`, getCliRootAttributes(command), fn);
}

export async function withSpan<T>(op: string, name: string, fn: () => Promise<T> | T): Promise<T>;
export async function withSpan<T>(
    op: string,
    name: string,
    attributes: Record<string, TelemetryAttribute>,
    fn: () => Promise<T> | T,
): Promise<T>;
export async function withSpan<T>(
    op: string,
    name: string,
    attributesOrFn: Record<string, TelemetryAttribute> | (() => Promise<T> | T),
    maybeFn?: () => Promise<T> | T,
): Promise<T> {
    const fn = (typeof attributesOrFn === "function" ? attributesOrFn : maybeFn) as () =>
        | Promise<T>
        | T;
    const attributes = typeof attributesOrFn === "function" ? {} : (attributesOrFn ?? {});
    if (!Sentry) return await fn();
    return await Sentry.startSpan(
        { op, name, attributes: sanitizeAttributes(attributes) },
        async (span) => {
            try {
                return await fn();
            } catch (error) {
                const msg = sanitizedErrorMessage(error);
                setSpanAttribute(span, "error.message", msg);
                setSpanStatus(span, { code: 2, message: "internal_error" });
                throw error;
            }
        },
    );
}

export function setTelemetryTag(key: string, value: string): void {
    if (!Sentry) return;
    try {
        Sentry.setTag(key, sanitizeTelemetryString(value));
    } catch {
        // ignore
    }
}

/**
 * Emit a warning event tied to the current root span.
 *
 * The `message` is path-scrubbed and truncated to 200 chars. The `context`
 * object is recursively sanitised — strings inside it are also scrubbed and
 * truncated. Callers must NOT pre-truncate; double-truncation creates jagged
 * suffixes and indicates the helper's contract isn't trusted. High-cardinality
 * variants (CIDs, addresses, full URLs) embedded into the `message` itself
 * will fragment the Sentry issue group — keep `message` a stable prefix and
 * push variable values into `context`.
 *
 * Side effects:
 *   1. Adds a breadcrumb to the trace timeline.
 *   2. Captures a standalone warning event (queryable as `level:warning`).
 *   3. Flips the active root span's `cli.sad` attribute and the `cli.sad`
 *      Sentry scope tag to `"true"` so SAD% calculations include retries
 *      that ultimately succeeded.
 */
export function captureWarning(message: string, context?: Record<string, unknown>): void {
    if (!Sentry) return;
    try {
        const sanitizedMessage = sanitizeTelemetryString(message);
        const extra = sanitizeExtra(context);
        Sentry.addBreadcrumb({ level: "warning", message: sanitizedMessage, data: extra });
        Sentry.captureMessage(sanitizedMessage, { level: "warning", extra });
        const active = Sentry.getActiveSpan?.();
        const root = active ? Sentry.getRootSpan?.(active) : undefined;
        setSpanAttribute(root, "cli.sad", "true");
    } catch {
        // ignore
    }
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
    if (!Sentry) return;
    try {
        Sentry.captureException(error, { extra: sanitizeExtra(context) });
    } catch {
        // ignore
    }
}

export async function flushTelemetry(): Promise<void> {
    if (!Sentry) return;
    try {
        await Sentry.flush(5000);
    } catch {
        // ignore
    }
}

export async function closeTelemetry(timeoutMs: number): Promise<void> {
    if (!Sentry) return;
    try {
        await Sentry.close(timeoutMs);
    } catch {
        // ignore
    }
}

export function _resetTelemetryForTesting(): void {
    Sentry = null;
    initStarted = false;
}

export function getRuntimeTelemetryContext(): Record<string, string> {
    return {
        runner: resolveRunner(),
        runnerType: resolveRunnerType(),
    };
}
