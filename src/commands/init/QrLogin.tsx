import { useState, useEffect } from "react";
import { Row } from "../../utils/ui/theme/index.js";
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

    if (status.step === "success") {
        return <Row mark="ok" label="logged in" value={status.address} tone="muted" />;
    }
    if (status.step === "error") {
        return <Row mark="fail" label="login failed" value={status.message} tone="danger" />;
    }
    return <Row mark="run" label="sign in" value="scan QR with the Polkadot app" tone="muted" />;
}
