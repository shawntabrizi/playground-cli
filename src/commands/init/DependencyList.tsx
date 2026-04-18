import { useState, useEffect } from "react";
import { Box } from "ink";
import { Row, LogTail, Section, type MarkKind } from "../../utils/ui/theme/index.js";
import { TOOL_STEPS, isGhAuthenticated } from "../../utils/toolchain.js";

type Status = "pending" | "checking" | "installing" | "ok" | "failed" | "warning";

const OUTPUT_LINES = 5;

interface StepState {
    name: string;
    status: Status;
    message?: string;
    hint?: string;
}

function toMark(status: Status): MarkKind {
    switch (status) {
        case "ok":
            return "ok";
        case "failed":
            return "fail";
        case "warning":
            return "warn";
        case "checking":
        case "installing":
            return "run";
        default:
            return "idle";
    }
}

export function DependencyList({ onDone }: { onDone: () => void }) {
    const [steps, setSteps] = useState<StepState[]>([
        ...TOOL_STEPS.map((s) => ({
            name: s.name,
            status: "pending" as Status,
            hint: s.manualHint,
        })),
        { name: "authenticated", status: "pending" as Status },
    ]);
    const [output, setOutput] = useState<string[]>([]);
    const [complete, setComplete] = useState(false);

    useEffect(() => {
        const onData = (line: string) => {
            setOutput((prev) => [...prev.slice(-(OUTPUT_LINES - 1)), line]);
        };

        (async () => {
            for (let i = 0; i < TOOL_STEPS.length; i++) {
                const step = TOOL_STEPS[i];
                setSteps((prev) =>
                    prev.map((s, j) => (j === i ? { ...s, status: "checking" } : s)),
                );

                if (await step.check()) {
                    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "ok" } : s)));
                } else {
                    setSteps((prev) =>
                        prev.map((s, j) => (j === i ? { ...s, status: "installing" } : s)),
                    );
                    setOutput([]);
                    try {
                        await step.install(onData);
                        setSteps((prev) =>
                            prev.map((s, j) => (j === i ? { ...s, status: "ok" } : s)),
                        );
                        setOutput([]);
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        setSteps((prev) =>
                            prev.map((s, j) =>
                                j === i ? { ...s, status: "failed", message: msg } : s,
                            ),
                        );
                    }
                }
            }

            // gh auth check (advisory — not auto-login)
            const authIdx = TOOL_STEPS.length;
            if (await isGhAuthenticated()) {
                setSteps((prev) =>
                    prev.map((s, j) => (j === authIdx ? { ...s, status: "ok" } : s)),
                );
            } else {
                setSteps((prev) =>
                    prev.map((s, j) =>
                        j === authIdx
                            ? { ...s, status: "warning", message: "run: gh auth login" }
                            : s,
                    ),
                );
            }

            setComplete(true);
        })();
    }, []);

    useEffect(() => {
        if (complete) onDone();
    }, [complete]);

    return (
        <Section title="dependencies">
            {steps.map((step) => (
                <Row
                    key={step.name}
                    mark={toMark(step.status)}
                    label={step.name}
                    value={step.message}
                    tone={
                        step.status === "failed"
                            ? "danger"
                            : step.status === "warning"
                              ? "warning"
                              : "muted"
                    }
                    hint={step.status === "failed" ? step.hint : undefined}
                />
            ))}
            {!complete && (
                <Box marginTop={1}>
                    <LogTail lines={output} height={OUTPUT_LINES} />
                </Box>
            )}
        </Section>
    );
}
