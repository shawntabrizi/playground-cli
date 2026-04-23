import { useEffect, useState } from "react";
import { Box } from "ink";
import { Header, Section } from "../../utils/ui/theme/index.js";
import { waitForLogout, type LogoutHandle, type LogoutStatus } from "../../utils/auth.js";
import { VERSION_LABEL } from "../../utils/version.js";
import { LogoutStatus as LogoutStatusRow } from "./LogoutStatus.js";
import { isTerminal } from "./status.js";

/**
 * Orchestrator for the sign-out flow. Owns status state, kicks off
 * `waitForLogout` once on mount, and calls `onDone` the moment the status
 * reaches a terminal step — the command wrapper unmounts on that signal.
 *
 * The adapter inside `handle` is destroyed by `waitForLogout` itself, so
 * this component doesn't need a useEffect cleanup for it.
 */
export function LogoutScreen({
    handle,
    onDone,
}: {
    handle: LogoutHandle;
    onDone: () => void;
}) {
    // Seed with `disconnecting` — findSession() already resolved the address
    // before this screen mounted, so there's no "checking" phase to show.
    const [status, setStatus] = useState<LogoutStatus>({
        step: "disconnecting",
        address: handle.address,
    });

    useEffect(() => {
        let cancelled = false;
        waitForLogout(handle, (s) => {
            if (!cancelled) setStatus(s);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (isTerminal(status)) onDone();
    }, [status]);

    return (
        <Box flexDirection="column">
            <Header
                cmd="dot logout"
                subtitle="polkadot playground"
                network="paseo"
                right={VERSION_LABEL}
            />
            <Section gapBelow={false}>
                <LogoutStatusRow status={status} />
            </Section>
        </Box>
    );
}
