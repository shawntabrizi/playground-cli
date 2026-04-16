import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Spinner, Done, Failed } from "../../utils/ui/index.js";
import { getConnection } from "../../utils/connection.js";
import { getSessionSigner, type SessionHandle } from "../../utils/auth.js";
import { checkBalance, ensureFunded, FUND_AMOUNT } from "../../utils/account/funding.js";
import { checkMapping, ensureMapped } from "../../utils/account/mapping.js";
import {
    checkAllowance,
    ensureAllowance,
    LOW_TX_THRESHOLD,
} from "../../utils/account/allowance.js";

type Status = "pending" | "active" | "ok" | "failed" | "skipped";

const STEP_COUNT = 3;

/** Planck per PAS (10 decimals). */
const PLANCK_PER_PAS = 10_000_000_000n;

interface StepState {
    label: string;
    status: Status;
    detail?: string;
    error?: string;
}

function StatusIcon({ status }: { status: Status }) {
    switch (status) {
        case "active":
            return <Spinner />;
        case "ok":
            return <Done />;
        case "failed":
            return <Failed />;
        case "skipped":
            return <Text dimColor>-</Text>;
        default:
            return <Text dimColor>·</Text>;
    }
}

/** Format planck as "X.YZ PAS" without going through lossy `Number(bigint)`. */
export function formatPas(planck: bigint): string {
    const whole = planck / PLANCK_PER_PAS;
    // Two decimal places: compute planck fraction of PAS in hundredths.
    const hundredths = (planck % PLANCK_PER_PAS) / (PLANCK_PER_PAS / 100n);
    const frac = hundredths.toString().padStart(2, "0");
    return `${whole.toString()}.${frac} PAS`;
}

/** Format a raw byte count as "N MB" using integer math (no precision loss). */
export function formatMb(bytes: bigint): string {
    const mb = bytes / 1_000_000n;
    return `${mb.toString()} MB`;
}

export function AccountSetup({
    address,
    onDone,
}: {
    address: string;
    onDone: (success: boolean) => void;
}) {
    const [steps, setSteps] = useState<StepState[]>([
        { label: "Funding account", status: "pending" },
        { label: "Mapping account (Revive)", status: "pending" },
        { label: "Granting bulletin access", status: "pending" },
    ]);

    useEffect(() => {
        let cancelled = false;
        let session: SessionHandle | null = null;

        const update = (idx: number, patch: Partial<StepState>) => {
            if (cancelled) return;
            setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
        };

        const finish = (success: boolean) => {
            if (cancelled) return;
            onDone(success);
        };

        const describe = (err: unknown): string =>
            err instanceof Error ? err.message : String(err);

        (async () => {
            let client: Awaited<ReturnType<typeof getConnection>>;
            try {
                client = await getConnection();
            } catch (err) {
                const msg = describe(err);
                for (let i = 0; i < STEP_COUNT; i++) update(i, { status: "failed", error: msg });
                finish(false);
                return;
            }
            if (cancelled) return;

            // Step 0: Fund from Alice
            let funded = false;
            update(0, { status: "active" });
            try {
                const before = await checkBalance(client, address);
                if (cancelled) return;
                if (before.sufficient) {
                    update(0, {
                        status: "ok",
                        detail: `Balance: ${formatPas(before.free)}`,
                    });
                    funded = true;
                } else {
                    update(0, {
                        status: "active",
                        detail: `Balance: ${formatPas(before.free)} — funding...`,
                    });
                    await ensureFunded(client, address);
                    if (cancelled) return;
                    // Optimistic post-balance: avoids a second RPC call that
                    // could read a stale best-block and display the old value.
                    const expected = before.free + FUND_AMOUNT;
                    update(0, {
                        status: "ok",
                        detail: `Balance: ${formatPas(expected)}`,
                    });
                    funded = true;
                }
            } catch (err) {
                update(0, { status: "failed", error: describe(err) });
            }

            // Step 1: Revive mapping (requires funds, user signs via mobile wallet)
            if (funded) {
                update(1, { status: "active" });
                try {
                    const mapped = await checkMapping(client, address);
                    if (cancelled) return;
                    if (mapped) {
                        update(1, { status: "ok", detail: "Already mapped" });
                    } else {
                        session = await getSessionSigner();
                        if (cancelled) return;
                        if (!session) {
                            update(1, {
                                status: "failed",
                                error: "No session — run dot init to log in",
                            });
                        } else {
                            update(1, {
                                status: "active",
                                detail: "Approve on your Polkadot mobile app...",
                            });
                            await ensureMapped(client, address, session.signer);
                            if (cancelled) return;
                            update(1, { status: "ok", detail: "Mapped" });
                        }
                    }
                } catch (err) {
                    update(1, { status: "failed", error: describe(err) });
                }
            } else {
                update(1, { status: "skipped", error: "Skipped — account not funded" });
            }

            // Step 2: Bulletin allowance (Alice signs, independent of mapping)
            update(2, { status: "active" });
            try {
                const before = await checkAllowance(client, address);
                if (cancelled) return;
                if (before.authorized && before.remainingTxs >= LOW_TX_THRESHOLD) {
                    update(2, {
                        status: "ok",
                        detail: `${before.remainingTxs} txs, ${formatMb(before.remainingBytes)} remaining`,
                    });
                } else {
                    update(2, {
                        status: "active",
                        detail: before.authorized
                            ? `Low quota (${before.remainingTxs} txs) — authorizing...`
                            : "Not authorized — authorizing...",
                    });
                    await ensureAllowance(client, address);
                    if (cancelled) return;
                    const after = await checkAllowance(client, address);
                    if (cancelled) return;
                    update(2, {
                        status: "ok",
                        detail: `${after.remainingTxs} txs, ${formatMb(after.remainingBytes)} remaining`,
                    });
                }
            } catch (err) {
                update(2, { status: "failed", error: describe(err) });
            }

            finish(funded);
        })().finally(() => {
            // Always release the session adapter once setup has finished (or bailed).
            session?.destroy();
        });

        return () => {
            cancelled = true;
            // If the component unmounts mid-flight the IIFE's finally will
            // also fire and clean up, but do it eagerly here too so we don't
            // hang on an in-flight mobile sign request.
            session?.destroy();
        };
    }, [address, onDone]);

    return (
        <Box flexDirection="column" paddingLeft={2}>
            <Box marginBottom={1}>
                <Text bold>Account setup</Text>
            </Box>
            {steps.map((step) => (
                <Box key={step.label} flexDirection="column">
                    <Box gap={1}>
                        <StatusIcon status={step.status} />
                        <Text>{step.label}</Text>
                        {step.detail && <Text dimColor>{step.detail}</Text>}
                    </Box>
                    {step.error && (
                        <Box paddingLeft={4}>
                            <Text dimColor>{step.error}</Text>
                        </Box>
                    )}
                </Box>
            ))}
        </Box>
    );
}
