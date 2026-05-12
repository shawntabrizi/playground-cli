// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { useState, useEffect } from "react";
import { Row, Section, type MarkKind } from "../../utils/ui/theme/index.js";
import { getConnection } from "../../utils/connection.js";
import { getSessionSigner, type SessionHandle } from "../../utils/auth.js";
import { checkMapping, ensureMapped } from "../../utils/account/mapping.js";

type Status = "pending" | "active" | "ok" | "failed" | "skipped";

/** Planck per PAS (10 decimals). */
const PLANCK_PER_PAS = 10_000_000_000n;

interface StepState {
    label: string;
    status: Status;
    value?: string;
    valueTone?: "default" | "danger" | "warning" | "muted" | "accent";
    hint?: string;
    error?: string;
}

function toMark(status: Status): MarkKind | undefined {
    switch (status) {
        case "active":
            return "run";
        case "ok":
            return "ok";
        case "failed":
            return "fail";
        case "skipped":
            return "idle";
        default:
            return "idle";
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
        { label: "asset hub mapping", status: "pending" },
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
                setSteps((prev) => prev.map((s) => ({ ...s, status: "failed", error: msg })));
                finish(false);
                return;
            }
            if (cancelled) return;

            let mappedOk = false;
            update(0, { status: "active" });
            try {
                const mapped = await checkMapping(client, address);
                if (cancelled) return;
                if (mapped) {
                    update(0, { status: "ok", value: "mapped", valueTone: "muted" });
                    mappedOk = true;
                } else {
                    session = await getSessionSigner();
                    if (cancelled) return;
                    if (!session) {
                        update(0, {
                            status: "failed",
                            error: "no session — run dot init to log in",
                        });
                    } else {
                        update(0, {
                            status: "active",
                            value: "approve on your Polkadot mobile app…",
                            valueTone: "muted",
                        });
                        await ensureMapped(client, address, session.signer);
                        if (cancelled) return;
                        update(0, { status: "ok", value: "mapped", valueTone: "muted" });
                        mappedOk = true;
                    }
                }
            } catch (err) {
                update(0, { status: "failed", error: describe(err) });
            }

            finish(mappedOk);
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
        <Section title="account">
            {steps.map((step) => (
                <Row
                    key={step.label}
                    mark={toMark(step.status)}
                    label={step.label}
                    value={step.value}
                    tone={step.valueTone ?? "default"}
                    hint={step.error ?? step.hint}
                />
            ))}
        </Section>
    );
}
