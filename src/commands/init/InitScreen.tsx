import { useState } from "react";
import { Box, Text } from "ink";
import { DependencyList } from "./DependencyList.js";
import { QrLogin } from "./QrLogin.js";
import type { LoginHandle } from "../../utils/auth.js";

export function InitScreen({
    login,
    existingAddress,
    onDone,
}: {
    login: LoginHandle | null;
    existingAddress: string | null;
    onDone: () => void;
}) {
    const needsAuth = login !== null;
    const [depsComplete, setDepsComplete] = useState(false);
    const [authComplete, setAuthComplete] = useState(!needsAuth);

    const handleDepsDone = () => {
        setDepsComplete(true);
        if (authComplete) onDone();
    };

    const handleAuthDone = () => {
        setAuthComplete(true);
        if (depsComplete) onDone();
    };

    return (
        <Box flexDirection="column">
            {needsAuth && <QrLogin login={login} onDone={handleAuthDone} />}
            {existingAddress && (
                <Box paddingLeft={2} gap={1} marginBottom={1}>
                    <Text color="green">✔</Text>
                    <Text bold>Logged in</Text>
                    <Text dimColor>{existingAddress}</Text>
                </Box>
            )}
            <DependencyList onDone={handleDepsDone} />
            {depsComplete && authComplete && (
                <Box paddingLeft={2} marginTop={1}>
                    <Text color="green">✔</Text>
                    <Text bold> Setup complete</Text>
                </Box>
            )}
        </Box>
    );
}
