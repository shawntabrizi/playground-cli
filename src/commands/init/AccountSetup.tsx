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

import { Box, Text } from "ink";
import { useState, useEffect } from "react";
import { Row, Section, Callout, type MarkKind } from "../../utils/ui/theme/index.js";
import { getConnection } from "../../utils/connection.js";
import { getSessionSigner, type SessionHandle } from "../../utils/auth.js";
import { topUpFromBulletinDev } from "../../utils/account/bulletinTopUp.js";
import { checkMapping, ensureMapped } from "../../utils/account/mapping.js";
import { DEFAULT_ENV, PLAYGROUND_PRODUCT_ID } from "../../config.js";
import {
    PLAYGROUND_RESOURCES,
    requestResourceAllocation,
    summarizeOutcomes,
    type AllocatableResource,
} from "../../utils/allowances/host.js";
import { hasAllowance, markAllowance } from "../../utils/allowances/marker.js";
import {
    hasUsableBulletinSlotAuthorization,
    waitForBulletinSlotAuthorization,
} from "../../utils/allowances/bulletin.js";
import {
    extractSlotAccountKey,
    hasSlotAccountKey,
    readSlotAccountKey,
    storeSlotAccountKeysFromOutcomes,
} from "../../utils/allowances/slotKeys.js";

type Status = "pending" | "active" | "ok" | "failed" | "skipped";

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

interface PhonePrompt {
    step: number;
    total: number;
    label: string;
}

/** Human-readable name for a resource tag, used in failure messages. */
function describeResource(r: AllocatableResource): string {
    switch (r.tag) {
        case "BulletInAllowance":
            return "Bulletin storage";
        case "StatementStoreAllowance":
            return "Statement Store";
        case "SmartContractAllowance":
            return `smart-contract gas (idx ${r.value})`;
        case "AutoSigning":
            return "auto-signing";
    }
}

export function AccountSetup({
    address,
    onDone,
}: {
    address: string;
    onDone: (success: boolean) => void;
}) {
    const [steps, setSteps] = useState<StepState[]>([
        { label: "allowances", status: "pending" },
        { label: "funding", status: "pending" },
    ]);
    const [phonePrompt, setPhonePrompt] = useState<PhonePrompt | null>(null);

    useEffect(() => {
        let cancelled = false;
        let session: SessionHandle | null = null;

        const update = (idx: number, patch: Partial<StepState>) => {
            if (cancelled) return;
            setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
        };

        const finish = (success: boolean) => {
            if (cancelled) return;
            setPhonePrompt(null);
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

            session = await getSessionSigner();
            if (cancelled) return;
            if (!session) {
                setSteps((prev) =>
                    prev.map((s) => ({
                        ...s,
                        status: "failed",
                        error: "no session — run dot init to log in",
                    })),
                );
                finish(false);
                return;
            }

            const env = DEFAULT_ENV;

            // ── Step 0: Resource allowances ─────────────────────────────────
            // Allowances are requested against the product-derived account
            // (host-papp's `productAccountId = [PLAYGROUND_PRODUCT_ID, 0]`),
            // which is the same SS58 used everywhere else in this flow.
            //
            // A note on non-fatal Bulletin timeouts: mobile derives the slot
            // account from the user's root and submits `claim_long_term_storage`
            // on People Chain; the authorization is supposed to propagate to
            // Bulletin Chain via on-chain mechanics. The mobile waits 30s for
            // visibility and swallows the failure, returning the slot key
            // regardless. Our wait can therefore time out even on the happy
            // path where the chain *will* catch up. The slot key + marker are
            // still cached so the next run / `dot deploy` picks them up, and
            // the funding + mapping steps below DO NOT depend on Bulletin
            // authorization — they only need the product account on Asset
            // Hub. Treat the Bulletin timeout as a soft failure, surface the
            // faucet help, and continue.
            update(0, { status: "active", value: "checking…", valueTone: "muted" });
            let accountSetupOk = true;
            try {
                const tags = PLAYGROUND_RESOURCES.map((r) => r.tag);
                const marked = await Promise.all(tags.map((t) => hasAllowance(env, address, t)));
                const cachedBulletinKey = await readSlotAccountKey(
                    env,
                    address,
                    "BulletInAllowance",
                );
                const slotKeys = await Promise.all([
                    Promise.resolve(cachedBulletinKey !== null),
                    hasSlotAccountKey(env, address, "StatementStoreAllowance"),
                ]);
                if (cancelled) return;
                const cachedBulletinUsable =
                    cachedBulletinKey === null
                        ? false
                        : await hasUsableBulletinSlotAuthorization(
                              client.bulletin,
                              cachedBulletinKey,
                          );
                const allMarked =
                    marked.every(Boolean) && slotKeys.every(Boolean) && cachedBulletinUsable;
                if (allMarked) {
                    update(0, {
                        status: "ok",
                        value: "already granted",
                        valueTone: "muted",
                    });
                } else {
                    update(0, {
                        status: "active",
                        value: "approve on your Polkadot mobile app…",
                        valueTone: "muted",
                    });
                    setPhonePrompt({
                        step: 1,
                        total: 1,
                        label: "grant resource allowances",
                    });
                    const outcomes = await requestResourceAllocation(
                        session.userSession,
                        PLAYGROUND_PRODUCT_ID,
                    );
                    if (cancelled) return;
                    setPhonePrompt(null);
                    const summary = summarizeOutcomes(outcomes, PLAYGROUND_RESOURCES);

                    // Persist every slot key the mobile returned BEFORE the
                    // Bulletin propagation wait — a `waitForBulletinSlotAuthorization`
                    // timeout below shouldn't discard a perfectly valid key.
                    await storeSlotAccountKeysFromOutcomes(env, address, outcomes);
                    // RFC-0010 allocation outcomes are independent: keep any
                    // successful keys even if a sibling resource was denied.
                    await Promise.all(
                        summary.granted.map((r) => markAllowance(env, address, r.tag, "host")),
                    );

                    if (summary.rejected.length > 0 || summary.unavailable.length > 0) {
                        const denied = [...summary.rejected, ...summary.unavailable]
                            .map(describeResource)
                            .join(", ");
                        update(0, {
                            status: "failed",
                            error: `denied: ${denied}. Re-run \`dot init\` and approve on your phone.`,
                            valueTone: "danger",
                        });
                        finish(false);
                        return;
                    }

                    const bulletinKey = extractSlotAccountKey(outcomes, "BulletInAllowance");
                    if (bulletinKey) {
                        try {
                            await waitForBulletinSlotAuthorization(client.bulletin, bulletinKey);
                        } catch (waitErr) {
                            // Soft failure: key + marker are cached above, so
                            // the next run / `dot deploy` will see them. The
                            // funding/mapping step doesn't need this, so we
                            // surface the help and keep going. The user has
                            // already approved on their phone at this point
                            // — the problem is People→Bulletin propagation,
                            // not a pending mobile prompt, so the row label
                            // mustn't ask them to re-approve.
                            accountSetupOk = false;
                            update(0, {
                                status: "failed",
                                value: "Bulletin authorization pending",
                                error: describe(waitErr),
                                valueTone: "warning",
                            });
                        }
                    }
                    if (cancelled) return;
                    if (accountSetupOk) {
                        update(0, {
                            status: "ok",
                            value: `granted (${summary.granted.length})`,
                            valueTone: "muted",
                        });
                    }
                }
            } catch (err) {
                setPhonePrompt(null);
                update(0, {
                    status: "failed",
                    error: describe(err),
                    valueTone: "danger",
                });
                finish(false);
                return;
            }

            // ── Step 1: Top up the product-derived account ──────────────────
            // paseo-next-v2's pallet_revive::AutoMapper creates the H160
            // mapping on the first state-changing tx the product account
            // submits, so we don't run an explicit `Revive.map_account` here
            // by default. We mirror bulletin-deploy's `attemptTestnetTopUp`
            // and ensure the product-derived account has enough PAS to cover
            // the auto-map trigger fee bulletin-deploy submits during
            // `dot deploy`. Reuses the same dev source signer bulletin-deploy
            // uses so the funding lands on a chain that is actually
            // pre-funded (paseo-next-v2).
            //
            // Belt-and-braces: after funding, re-check the on-chain mapping
            // and submit an explicit `Revive.map_account` if AutoMapper did
            // not fire (e.g. the account pre-existed the AutoMapper runtime
            // upgrade and a fresh `OnNewAccount` was never triggered). This
            // covers the cold-start case the deploy preflight error message
            // ("Account is not mapped in Revive. Run `dot init`...") would
            // otherwise leave the user stuck on.
            update(1, { status: "active", value: "checking balance…", valueTone: "muted" });
            try {
                const result = await topUpFromBulletinDev(client, address);
                if (cancelled) return;
                let detail = result.skipped ? "already funded" : "+1 PAS";

                // `ensureMapped` is a no-op when the account is already
                // mapped (the underlying SDK helper hard-errors only on
                // mapping failures we want to surface). `checkMapping`
                // catches the common case so we don't print "mapping…" on
                // every re-run.
                const mapped = await checkMapping(client, address);
                if (cancelled) return;
                if (!mapped) {
                    update(1, {
                        status: "active",
                        value: "registering H160 mapping…",
                        valueTone: "muted",
                    });
                    await ensureMapped(client, address, session.signer);
                    if (cancelled) return;
                    detail = `${detail} + mapped`;
                }
                update(1, { status: "ok", value: detail, valueTone: "muted" });
            } catch (err) {
                update(1, {
                    status: "failed",
                    error: describe(err),
                    valueTone: "danger",
                });
                finish(false);
                return;
            }

            finish(accountSetupOk);
        })();

        // Cleanup is the SOLE owner of `session?.destroy()`. Calling destroy()
        // from a `.finally()` AND here races them — both fire near-instantly on
        // success/failure, and the second one trips a half-torn-down adapter
        // into surfacing `DestroyedError: Client destroyed` from
        // polkadot-api's raw-client. Even though the wrapped `destroy()` has an
        // idempotency flag, the inner `adapter.destroy()` is fire-and-forget,
        // so the second invocation sees `destroyed=true` while the first's
        // async drain is still in flight, and rejections leak as
        // unhandledRejection (the process-guard's stderr write then corrupts
        // Ink's cursor anchor and the whole screen re-renders stacked).
        return () => {
            cancelled = true;
            session?.destroy();
        };
    }, [address, onDone]);

    return (
        <Box flexDirection="column">
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
            {phonePrompt && (
                <Callout tone="warning" title="check your phone">
                    <Text>
                        approve step {phonePrompt.step} of {phonePrompt.total}:{" "}
                        <Text bold>{phonePrompt.label}</Text>
                    </Text>
                </Callout>
            )}
        </Box>
    );
}
