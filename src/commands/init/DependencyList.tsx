import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Spinner, Done, Failed, Warning } from "../../utils/ui/index.js";
import { TOOL_STEPS, commandExists, isGhAuthenticated } from "../../utils/toolchain.js";

type Status = "pending" | "checking" | "installing" | "ok" | "failed" | "warning";

interface StepState {
    name: string;
    status: Status;
    message?: string;
}

function StatusIcon({ status }: { status: Status }) {
    switch (status) {
        case "checking":
        case "installing":
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

export function DependencyList({ onDone }: { onDone: () => void }) {
    const [steps, setSteps] = useState<StepState[]>([
        ...TOOL_STEPS.map((s) => ({ name: s.name, status: "pending" as Status })),
        { name: "GitHub CLI", status: "pending" as Status },
    ]);
    const [complete, setComplete] = useState(false);
    const [allOk, setAllOk] = useState(true);

    useEffect(() => {
        (async () => {
            let ok = true;

            for (let i = 0; i < TOOL_STEPS.length; i++) {
                const step = TOOL_STEPS[i];
                setSteps((prev) =>
                    prev.map((s, j) => (j === i ? { ...s, status: "checking" } : s)),
                );

                if (step.check()) {
                    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "ok" } : s)));
                } else {
                    setSteps((prev) =>
                        prev.map((s, j) => (j === i ? { ...s, status: "installing" } : s)),
                    );
                    try {
                        step.install();
                        setSteps((prev) =>
                            prev.map((s, j) => (j === i ? { ...s, status: "ok" } : s)),
                        );
                    } catch {
                        ok = false;
                        setSteps((prev) =>
                            prev.map((s, j) =>
                                j === i ? { ...s, status: "failed", message: step.manualHint } : s,
                            ),
                        );
                    }
                }
            }

            // GitHub CLI (advisory — not auto-installed)
            const ghIdx = TOOL_STEPS.length;
            if (!commandExists("gh")) {
                setSteps((prev) =>
                    prev.map((s, j) =>
                        j === ghIdx
                            ? { ...s, status: "warning", message: "https://cli.github.com" }
                            : s,
                    ),
                );
            } else if (!isGhAuthenticated()) {
                setSteps((prev) =>
                    prev.map((s, j) =>
                        j === ghIdx
                            ? { ...s, status: "warning", message: "Run: gh auth login" }
                            : s,
                    ),
                );
            } else {
                setSteps((prev) => prev.map((s, j) => (j === ghIdx ? { ...s, status: "ok" } : s)));
            }

            setAllOk(ok);
            setComplete(true);
        })();
    }, []);

    useEffect(() => {
        if (complete) onDone();
    }, [complete]);

    return (
        <Box flexDirection="column" paddingLeft={2}>
            <Box marginBottom={1}>
                <Text bold>Installing dependencies</Text>
            </Box>
            {steps.map((step) => (
                <Box key={step.name} gap={1}>
                    <StatusIcon status={step.status} />
                    <Text>{step.name}</Text>
                    {step.message && <Text dimColor>{step.message}</Text>}
                </Box>
            ))}
            {complete && (
                <Box marginTop={1}>
                    {allOk ? (
                        <Text>
                            <Text color="green">✔</Text>{" "}
                            <Text bold>All dependencies installed</Text>
                        </Text>
                    ) : (
                        <Text>
                            <Text color="red">✖</Text>{" "}
                            <Text bold>Some dependencies failed to install</Text>
                        </Text>
                    )}
                </Box>
            )}
        </Box>
    );
}
