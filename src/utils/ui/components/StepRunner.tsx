/**
 * Reusable step runner — displays a list of sequential steps with
 * spinner → ✔/✖/! transitions and a fixed-height log box for output.
 *
 * Errors are passed to onDone for the parent to display below the UI.
 * Warnings (isWarning = true) show inline and don't stop execution.
 */

import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Spinner, Done, Failed, Warning } from "./loading.js";

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

function StatusIcon({ status }: { status: StepStatus }) {
    switch (status) {
        case "running":
            return <Spinner />;
        case "ok":
            return <Done />;
        case "failed":
            return <Failed />;
        case "warning":
            return <Warning />;
        default:
            return <Text dimColor>·</Text>;
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

    useEffect(() => {
        let cancelled = false;

        (async () => {
            let error: string | undefined;

            for (let i = 0; i < steps.length; i++) {
                if (cancelled) break;

                setStates((prev) =>
                    prev.map((s, j) => (j === i ? { ...s, status: "running" } : s)),
                );
                setOutput([]);

                try {
                    await steps[i].run((line) => {
                        setOutput((prev) => [...prev.slice(-(LOG_LINES - 1)), line]);
                    });
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
        };
    }, []);

    const running = states.some((s) => s.status === "running");

    return (
        <Box flexDirection="column" paddingLeft={2}>
            <Box marginBottom={1} marginTop={1}>
                <Text bold>{title}</Text>
            </Box>

            {states.map((step) => (
                <Box key={step.name} gap={1}>
                    <StatusIcon status={step.status} />
                    <Text>
                        {step.name}
                        {step.message ? <Text dimColor> — {step.message}</Text> : ""}
                    </Text>
                </Box>
            ))}

            {running && output.length > 0 && (
                <Box flexDirection="column" marginTop={1} paddingLeft={2} height={LOG_LINES}>
                    {Array.from({ length: LOG_LINES }, (_, i) => (
                        <Text key={i} dimColor>
                            {output[i] ?? " "}
                        </Text>
                    ))}
                </Box>
            )}
        </Box>
    );
}
