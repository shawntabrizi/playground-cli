import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Spinner, Done, Failed, Warning } from "../../utils/ui/index.js";
import { TOOL_STEPS, isGhAuthenticated } from "../../utils/toolchain.js";

type Status = "pending" | "checking" | "installing" | "ok" | "failed" | "warning";

const OUTPUT_LINES = 5;

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
        { name: "Authenticated", status: "pending" as Status },
    ]);
    const [output, setOutput] = useState<string[]>([]);
    const [complete, setComplete] = useState(false);
    const [allOk, setAllOk] = useState(true);

    useEffect(() => {
        const onData = (line: string) => {
            setOutput((prev) => [...prev.slice(-(OUTPUT_LINES - 1)), line]);
        };

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
                    setOutput([]);
                    try {
                        await step.install(onData);
                        setSteps((prev) =>
                            prev.map((s, j) => (j === i ? { ...s, status: "ok" } : s)),
                        );
                        setOutput([]);
                    } catch (err) {
                        ok = false;
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
                            ? { ...s, status: "warning", message: "Run: gh auth login" }
                            : s,
                    ),
                );
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
            {!complete && (
                <Box flexDirection="column" marginTop={1} paddingLeft={2} height={OUTPUT_LINES}>
                    {Array.from({ length: OUTPUT_LINES }, (_, i) => (
                        <Text key={i} dimColor>
                            {output[i] ?? " "}
                        </Text>
                    ))}
                </Box>
            )}
            {complete && (
                <Box marginTop={1}>
                    {allOk ? (
                        <Text>
                            <Text color="green">✔</Text>{" "}
                            <Text bold>All dependencies installed</Text>
                        </Text>
                    ) : (
                        <Box flexDirection="column">
                            {steps
                                .filter((s) => s.status === "failed")
                                .map((s) => (
                                    <Box key={s.name} flexDirection="column">
                                        <Text>
                                            <Text color="red">✖</Text>{" "}
                                            <Text bold>{s.name}</Text>
                                        </Text>
                                        {s.message && <Text>{s.message}</Text>}
                                    </Box>
                                ))}
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
}
