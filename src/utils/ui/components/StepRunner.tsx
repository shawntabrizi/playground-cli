/**
 * Reusable step runner — displays a list of sequential steps with status
 * marks and a fixed-height log tail for step output.
 *
 * Errors are passed to onDone for the parent to display below the UI.
 * Warnings (`isWarning = true`) show inline and don't stop execution.
 */

import { useState, useEffect, useRef } from "react";
import { Box } from "ink";
import { Row, Section, LogTail, type MarkKind } from "../theme/index.js";

// Coalesce log updates to ≤10 Hz — see CLAUDE.md "Throttle TUI info updates".
const LOG_THROTTLE_MS = 100;
const LOG_LINE_MAX = 160;

export interface Step {
    name: string;
    run: (log: (line: string) => void) => Promise<void>;
}

type StepStatus = "pending" | "running" | "ok" | "failed" | "warning";

interface StepState {
    name: string;
    status: StepStatus;
    message?: string;
}

const LOG_LINES = 5;

function toMark(status: StepStatus): MarkKind {
    switch (status) {
        case "running":
            return "run";
        case "ok":
            return "ok";
        case "failed":
            return "fail";
        case "warning":
            return "warn";
        default:
            return "idle";
    }
}

export interface StepRunnerResult {
    ok: boolean;
    error?: string;
}

interface Props {
    title: string;
    steps: Step[];
    onDone: (result: StepRunnerResult) => void;
}

export function StepRunner({ title, steps, onDone }: Props) {
    const [states, setStates] = useState<StepState[]>(
        steps.map((s) => ({ name: s.name, status: "pending" })),
    );
    const [output, setOutput] = useState<string[]>([]);

    const bufferRef = useRef<string[]>([]);
    const flushTimerRef = useRef<NodeJS.Timeout | null>(null);
    const scheduleFlush = () => {
        if (flushTimerRef.current !== null) return;
        flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            setOutput([...bufferRef.current]);
        }, LOG_THROTTLE_MS);
    };

    useEffect(() => {
        let cancelled = false;

        const pushLine = (line: string) => {
            const truncated =
                line.length > LOG_LINE_MAX ? `${line.slice(0, LOG_LINE_MAX - 1)}…` : line;
            const next = [...bufferRef.current, truncated].slice(-LOG_LINES);
            bufferRef.current = next;
            scheduleFlush();
        };

        const clearBuffer = () => {
            bufferRef.current = [];
            setOutput([]);
        };

        (async () => {
            let error: string | undefined;

            for (let i = 0; i < steps.length; i++) {
                if (cancelled) break;

                setStates((prev) =>
                    prev.map((s, j) => (j === i ? { ...s, status: "running" } : s)),
                );
                clearBuffer();

                try {
                    await steps[i].run(pushLine);
                    setStates((prev) => prev.map((s, j) => (j === i ? { ...s, status: "ok" } : s)));
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const isWarning = err instanceof Error && (err as any).isWarning === true;

                    if (isWarning) {
                        setStates((prev) =>
                            prev.map((s, j) =>
                                j === i ? { ...s, status: "warning", message: msg } : s,
                            ),
                        );
                    } else {
                        error = msg;
                        setStates((prev) =>
                            prev.map((s, j) => (j === i ? { ...s, status: "failed" } : s)),
                        );
                        break;
                    }
                }
            }

            if (!cancelled) onDone({ ok: !error, error });
        })();

        return () => {
            cancelled = true;
            if (flushTimerRef.current !== null) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const running = states.some((s) => s.status === "running");

    return (
        <Section title={title}>
            {states.map((step) => (
                <Row
                    key={step.name}
                    mark={toMark(step.status)}
                    label={step.name}
                    value={step.message}
                    tone={step.status === "failed" ? "danger" : "muted"}
                />
            ))}
            {running && output.length > 0 && (
                <Box marginTop={1}>
                    <LogTail lines={output} height={LOG_LINES} />
                </Box>
            )}
        </Section>
    );
}
