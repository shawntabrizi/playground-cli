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

/**
 * Reusable step runner — displays a list of sequential steps with status
 * marks and a fixed-height log tail for step output.
 *
 * Errors are passed to onDone for the parent to display below the UI.
 * Warnings (`isWarning = true`) show inline and don't stop execution.
 * Halting warnings (`haltAsWarning = true`) show inline with the warn mark and
 * STOP execution, but report `ok: false` with no `error` — for cases the
 * parent wants to present gently (its own Callout) rather than as a red
 * failure row, while still skipping any success-only output.
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
    /**
     * When true, the last RETAINED_LINES of this step's output stay rendered
     * under the row after the step completes successfully. Use sparingly —
     * this is for steps whose tail content carries lasting value to the user
     * (e.g. a setup script's "next steps" footer). Bounded by RETAINED_LINES
     * × LOG_LINE_MAX chars per step, so memory impact is trivial.
     */
    keepLogOnSuccess?: boolean;
}

type StepStatus = "pending" | "running" | "ok" | "failed" | "warning";

interface StepState {
    name: string;
    status: StepStatus;
    message?: string;
    /** Snapshotted tail for completed steps with `keepLogOnSuccess: true`. */
    retainedLog?: string[];
}

/** Live tail height while a step is running. */
const LIVE_LOG_LINES = 5;
/** Buffer cap and persisted-tail height for `keepLogOnSuccess` steps. */
const RETAINED_LINES = 25;

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
            const next = [...bufferRef.current, truncated].slice(-RETAINED_LINES);
            bufferRef.current = next;
            scheduleFlush();
        };

        const clearBuffer = () => {
            bufferRef.current = [];
            setOutput([]);
        };

        (async () => {
            let error: string | undefined;
            let halted = false;

            for (let i = 0; i < steps.length; i++) {
                if (cancelled) break;

                setStates((prev) =>
                    prev.map((s, j) => (j === i ? { ...s, status: "running" } : s)),
                );
                clearBuffer();

                try {
                    await steps[i].run(pushLine);
                    const retainedLog = steps[i].keepLogOnSuccess
                        ? [...bufferRef.current]
                        : undefined;
                    setStates((prev) =>
                        prev.map((s, j) => (j === i ? { ...s, status: "ok", retainedLog } : s)),
                    );
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const isWarning = err instanceof Error && (err as any).isWarning === true;
                    const haltAsWarning =
                        err instanceof Error && (err as any).haltAsWarning === true;

                    if (haltAsWarning) {
                        setStates((prev) =>
                            prev.map((s, j) =>
                                j === i ? { ...s, status: "warning", message: msg } : s,
                            ),
                        );
                        halted = true;
                        break;
                    }
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

            if (!cancelled) onDone({ ok: !error && !halted, error });
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
    const liveOutput = output.slice(-LIVE_LOG_LINES);

    return (
        <Section title={title}>
            {states.map((step) => (
                <Box key={step.name} flexDirection="column">
                    <Row
                        mark={toMark(step.status)}
                        label={step.name}
                        value={step.message}
                        tone={step.status === "failed" ? "danger" : "muted"}
                    />
                    {step.retainedLog && step.retainedLog.length > 0 && (
                        <Box marginTop={1} marginBottom={1}>
                            <LogTail lines={step.retainedLog} height={step.retainedLog.length} />
                        </Box>
                    )}
                </Box>
            ))}
            {running && liveOutput.length > 0 && (
                <Box marginTop={1}>
                    <LogTail lines={liveOutput} height={LIVE_LOG_LINES} />
                </Box>
            )}
        </Section>
    );
}
