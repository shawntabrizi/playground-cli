import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { DependencyList } from "./DependencyList.js";
import { QrLogin } from "./QrLogin.js";
import { AccountSetup } from "./AccountSetup.js";
import { computeAllDone } from "./completion.js";
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
    const needsQr = login !== null;
    const [loggedInAddress, setLoggedInAddress] = useState<string | null>(existingAddress);
    const [authResolved, setAuthResolved] = useState(!needsQr);
    const [depsComplete, setDepsComplete] = useState(false);
    const [accountComplete, setAccountComplete] = useState(false);
    const [accountOk, setAccountOk] = useState(true);

    const allDone = computeAllDone({
        needsQr,
        authResolved,
        loggedInAddress,
        depsComplete,
        accountComplete,
    });

    const handleDepsDone = () => {
        setDepsComplete(true);
    };

    const handleAuthDone = (address: string | null) => {
        if (address) setLoggedInAddress(address);
        setAuthResolved(true);
    };

    const handleAccountDone = (success: boolean) => {
        setAccountOk(success);
        setAccountComplete(true);
    };

    useEffect(() => {
        if (allDone) onDone();
    }, [allDone]);

    return (
        <Box flexDirection="column">
            {needsQr && <QrLogin login={login} onDone={handleAuthDone} />}
            {!needsQr && existingAddress && (
                <Box paddingLeft={2} gap={1} marginBottom={1}>
                    <Text color="green">✔</Text>
                    <Text bold>Logged in</Text>
                    <Text dimColor>{existingAddress}</Text>
                </Box>
            )}
            <DependencyList onDone={handleDepsDone} />
            {loggedInAddress && depsComplete && (
                <AccountSetup address={loggedInAddress} onDone={handleAccountDone} />
            )}
            {allDone && (
                <Box paddingLeft={2} marginTop={1}>
                    <Text color="green">✔</Text>
                    <Text bold> Setup complete</Text>
                    {!accountOk && <Text dimColor> (some account setup steps failed)</Text>}
                </Box>
            )}
        </Box>
    );
}
