import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Spinner, Done, Failed, Warning } from "../../utils/ui/index.js";
import { TOOL_STEPS, isGhAuthenticated } from "../../utils/toolchain.js";

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

export function DependencyList({
    skipAuth,
    onDone,
}: {
    skipAuth: boolean;
    onDone: () => void;
}) {
    const showAuth = !skipAuth;
    const [steps, setSteps] = useState<StepState[]>([
        ...TOOL_STEPS.map((s) => ({ name: s.name, status: "pending" as Status })),
        ...(showAuth ? [{ name: "Authenticated", status: "pending" as Status }] : []),
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

                if (await step.check()) {
                    setSteps((prev) => prev.map((s, j) => (j === i ? { ...s, status: "ok" } : s)));
                } else {
                    setSteps((prev) =>
                        prev.map((s, j) => (j === i ? { ...s, status: "installing" } : s)),
                    );
                    try {
                        await step.install();
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

            // gh auth (only if not skipped via -y)
            if (showAuth) {
                const authIdx = TOOL_STEPS.length;
                if (await isGhAuthenticated()) {
                    setSteps((prev) =>
                        prev.map((s, j) => (j === authIdx ? { ...s, status: "ok" } : s)),
                    );
                } else {
                    setSteps((prev) =>
                        prev.map((s, j) =>
                            j === authIdx
                                ? { ...s, status: "warning", message: "Run: gh auth login" }
                                : s,
                        ),
                    );
                }
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
