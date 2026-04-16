import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Spinner, Done, Failed } from "../../utils/ui/index.js";
import { waitForLogin, type LoginStatus, type LoginHandle } from "../../utils/auth.js";

export function QrLogin({
    login,
    onDone,
}: {
    login: LoginHandle;
    onDone: (address: string | null) => void;
}) {
    const [status, setStatus] = useState<LoginStatus>({ step: "waiting" });

    useEffect(() => {
        waitForLogin(login, setStatus).then(onDone);
    }, []);

    return (
        <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
            <Box marginBottom={1}>
                <Text bold>Logging in</Text>
            </Box>
            <Box gap={1}>
                {(status.step === "waiting" ||
                    status.step === "paired" ||
                    status.step === "attesting") && (
                    <>
                        <Spinner />
                        <Text>Sign in with the Polkadot App</Text>
                    </>
                )}
                {status.step === "success" && (
                    <>
                        <Done />
                        <Text bold>Logged in</Text>
                        <Text dimColor>{status.address}</Text>
                    </>
                )}
                {status.step === "error" && (
                    <>
                        <Failed />
                        <Text>Login failed</Text>
                        <Text dimColor>{status.message}</Text>
                    </>
                )}
            </Box>
        </Box>
    );
}
