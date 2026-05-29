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

import { Box } from "ink";
import { useEffect, useState } from "react";
import { Input, PhoneApprovalCallout, Row, Section, Select } from "../../utils/ui/theme/index.js";
import { getSessionSigner } from "../../utils/auth.js";
import {
    describeUsernameValidationError,
    isRegistryUsernameAvailable,
    lookupRegistryUsername,
    setRegistryUsername,
    USERNAME_MAX_LEN,
    USERNAME_MIN_LEN,
    validateUsernameClient,
} from "../../utils/username.js";
import type { SessionAddresses } from "../../utils/auth.js";

/**
 * Init-flow step that surfaces (and, on first run, claims) the user's
 * playground-registry username.
 *
 * Lifecycle:
 *   1. Read `registry.getUsername(productH160)` via best-block dry-run.
 *      Found → emit it to parent, render an "ok" row, done.
 *   2. Not found → Y/N picker. N emits `null` (no username, but step
 *      complete). Y advances to the text input.
 *   3. Input → on Enter, client-side validation runs (mirrors the
 *      contract's `validate_username`); on validator success,
 *      `isUsernameAvailable` is dry-run to catch already-taken names
 *      before burning a tx. The `Input` component clears stale errors
 *      on any keystroke but does NOT re-run the validator until the
 *      next submit.
 *   4. Submit → fetch the session signer, call `setUsername(name)` against
 *      the registry. Phone approval callout is shown while the tx is in
 *      flight. Success → emit the name. Revert / signer-reject → show
 *      inline error, let the user retry the input.
 *
 * Session lifecycle: `getSessionSigner()` is NOT memoised — every call
 * spins up a fresh terminal adapter with its own WebSocket (see
 * `auth.ts::createAdapter` invoked unconditionally on each call). This
 * prompt therefore owns the handle it opens and must destroy it once
 * the submit attempt resolves, regardless of success or failure. The
 * destroy is fire-and-forget; the adapter swallows post-destroy
 * `DestroyedError` itself.
 */
export interface UsernamePromptProps {
    addresses: SessionAddresses;
    onDone: (username: string | null) => void;
}

type Phase =
    | { kind: "looking-up" }
    | { kind: "already-set"; username: string }
    | { kind: "ask" }
    | { kind: "input"; externalError: string | null; checking: boolean }
    | { kind: "submitting"; name: string }
    | { kind: "complete"; username: string | null };

export function UsernamePrompt({ addresses, onDone }: UsernamePromptProps) {
    const [phase, setPhase] = useState<Phase>({ kind: "looking-up" });

    // Initial lookup: do we already have a name on file?
    useEffect(() => {
        let cancelled = false;
        lookupRegistryUsername(addresses.productH160 as `0x${string}`).then((existing) => {
            if (cancelled) return;
            if (existing) {
                setPhase({ kind: "already-set", username: existing });
            } else {
                setPhase({ kind: "ask" });
            }
        });
        return () => {
            cancelled = true;
        };
    }, [addresses.productH160]);

    // Once we land in a terminal state, notify the parent exactly once.
    useEffect(() => {
        if (phase.kind === "already-set") onDone(phase.username);
        else if (phase.kind === "complete") onDone(phase.username);
    }, [phase, onDone]);

    if (phase.kind === "looking-up") {
        return (
            <Section title="username">
                <Row
                    mark="run"
                    label="checking"
                    value="reading from playground registry…"
                    tone="muted"
                />
            </Section>
        );
    }

    if (phase.kind === "already-set") {
        return (
            <Section title="username">
                <Row mark="ok" label="set on registry" value={phase.username} />
            </Section>
        );
    }

    if (phase.kind === "ask") {
        return (
            <Section title="username">
                <Select<"yes" | "no">
                    label="Set a username for your playground profile?"
                    initialIndex={0}
                    options={[
                        { value: "yes", label: "Yes", hint: "claim a handle on the registry" },
                        { value: "no", label: "No", hint: "skip for now" },
                    ]}
                    onSelect={(choice) => {
                        if (choice === "yes") {
                            setPhase({ kind: "input", externalError: null, checking: false });
                        } else {
                            setPhase({ kind: "complete", username: null });
                        }
                    }}
                />
            </Section>
        );
    }

    if (phase.kind === "input") {
        const submit = async (raw: string) => {
            const name = raw.trim().toLowerCase();
            const err = validateUsernameClient(name);
            if (err) {
                setPhase({
                    kind: "input",
                    externalError: describeUsernameValidationError(err),
                    checking: false,
                });
                return;
            }

            // `isUsernameAvailable` returns null on an older contract or any
            // RPC blip — degrade gracefully: skip the precheck and let the tx
            // decide. Same contract as `lookupRegistryUsername`.
            setPhase({ kind: "input", externalError: null, checking: true });
            const available = await isRegistryUsernameAvailable(
                name,
                addresses.productH160 as `0x${string}`,
            );
            if (available === false) {
                setPhase({
                    kind: "input",
                    externalError: `"${name}" is already taken. Try a different one.`,
                    checking: false,
                });
                return;
            }

            setPhase({ kind: "submitting", name });
        };

        return (
            <Section title="username">
                <Input
                    label={`Choose a username (${USERNAME_MIN_LEN}–${USERNAME_MAX_LEN} chars, a–z, 0–9, hyphen)`}
                    placeholder="e.g. alice"
                    validate={(value) => {
                        const tag = validateUsernameClient(value.trim().toLowerCase());
                        return tag ? describeUsernameValidationError(tag) : null;
                    }}
                    externalError={phase.checking ? "checking availability…" : phase.externalError}
                    onSubmit={submit}
                />
            </Section>
        );
    }

    if (phase.kind === "submitting") {
        return <SubmitUsername name={phase.name} setPhase={setPhase} />;
    }

    // phase.kind === "complete"
    return null;
}

function SubmitUsername({
    name,
    setPhase,
}: {
    name: string;
    setPhase: (p: Phase) => void;
}) {
    useEffect(() => {
        let cancelled = false;
        (async () => {
            // We own this handle (see file-level docstring — `getSessionSigner`
            // is not memoised). Capture it locally so the finally block can
            // tear down its WebSocket adapter on every exit path. Forgetting
            // this leaks the adapter and `dot init` hangs after "setup
            // complete" (init runs with `hardExit: false`, so the event loop
            // must drain naturally).
            const session = await getSessionSigner();
            if (!session) {
                if (!cancelled)
                    setPhase({
                        kind: "input",
                        externalError: "Lost session — re-run playground init.",
                        checking: false,
                    });
                return;
            }
            try {
                await setRegistryUsername(session, name);
                if (!cancelled) setPhase({ kind: "complete", username: name });
            } catch (err) {
                if (cancelled) return;
                const msg = err instanceof Error ? err.message : String(err);
                setPhase({
                    kind: "input",
                    externalError: `Couldn't save your username: ${msg}`,
                    checking: false,
                });
            } finally {
                // Fire-and-forget. `SessionHandle.destroy()` returns void; the
                // underlying adapter swallows post-destroy artifacts (the
                // process-guard catches anything that leaks through).
                session.destroy();
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [name, setPhase]);

    return (
        <Section title="username">
            <Box flexDirection="column">
                <Row mark="run" label="submitting" value={name} tone="muted" />
                <PhoneApprovalCallout step={1} total={1} label="Set username" />
            </Box>
        </Section>
    );
}
