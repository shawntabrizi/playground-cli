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

/**
 * Interactive TUI for `dot decentralize`. The state-machine in `state.ts`
 * decides which prompt to show next; this file only wires the prompts to
 * `runDecentralize` and renders the live progress + final summary.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text } from "ink";
import {
    Callout,
    Header,
    Hint,
    Input,
    type MarkKind,
    Row,
    Section,
    Select,
    type SelectOption,
} from "../../utils/ui/theme/index.js";
import { PhoneApprovalCallout } from "../../utils/ui/theme/PhoneApprovalCallout.js";
import { getNetworkLabel, type Env } from "../../config.js";
import { VERSION_LABEL } from "../../utils/version.js";
import type { ResolvedSigner } from "../../utils/signer.js";
import { createDevPublishSigner, type SignerMode } from "../../utils/deploy/signerMode.js";
import type { SigningEvent } from "../../utils/deploy/signingProxy.js";
import { resolveDomain } from "../../utils/decentralize/domain.js";
import {
    describeDeployEvent,
    runDecentralize,
    type DecentralizeOutcome,
} from "../../utils/decentralize/run.js";
import { pickNextStage, validateDomainInput, validateSiteUrlInput, type Stage } from "./state.js";

/**
 * What the screen reports back when it unmounts. The host (`runInteractive`)
 * maps each variant to an exit code: `success` and `cancel` resolve cleanly
 * (exit 0); `error` rejects so telemetry records the failure (exit 1). The
 * TUI itself has already rendered any user-visible message before this fires
 * — `runInteractive` never re-prints.
 */
export type DecentralizeResult =
    | { kind: "success"; outcome: DecentralizeOutcome }
    | { kind: "cancel" }
    | { kind: "error"; message: string };

export interface DecentralizeScreenProps {
    env: Env;
    initialSiteUrl: string | null;
    initialDot: string | null;
    /** `--suri` resolved up front. When set, the signer picker is skipped. */
    explicitSigner: ResolvedSigner | null;
    /** Session signer from `dot init`, if any. Picked when "phone" is selected. */
    sessionSigner: ResolvedSigner | null;
    /**
     * Pre-set when `--playground` was passed on the CLI. `null` means the
     * publish prompt is shown.
     */
    initialPublishToPlayground: boolean | null;
    onDone: (result: DecentralizeResult) => void;
}

export function DecentralizeScreen({
    env,
    initialSiteUrl,
    initialDot,
    explicitSigner,
    sessionSigner,
    initialPublishToPlayground,
    onDone,
}: DecentralizeScreenProps) {
    const [siteUrl, setSiteUrl] = useState<string | null>(initialSiteUrl);
    // If --suri was passed, the user has effectively pre-chosen dev.
    const [signerMode, setSignerMode] = useState<SignerMode | null>(explicitSigner ? "dev" : null);
    const [domainRaw, setDomainRaw] = useState<string | null>(initialDot);
    const [domainLabel, setDomainLabel] = useState<string | null>(null);
    const [fullDomain, setFullDomain] = useState<string | null>(null);
    const [availabilityNote, setAvailabilityNote] = useState<string | null>(null);
    const [domainError, setDomainError] = useState<string | null>(null);
    const [validationMessage, setValidationMessage] = useState<string | null>(null);
    const [publishToPlayground, setPublishToPlayground] = useState<boolean | null>(
        initialPublishToPlayground,
    );

    const [stage, setStage] = useState<Stage>(() =>
        pickNextStage({
            siteUrl: initialSiteUrl,
            signerMode: explicitSigner ? "dev" : null,
            domainLabel: null,
            domainRaw: initialDot,
            publishToPlayground: initialPublishToPlayground,
        }),
    );

    const advance = (
        next: Partial<{
            siteUrl: string | null;
            signerMode: SignerMode | null;
            domainLabel: string | null;
            domainRaw: string | null;
            publishToPlayground: boolean | null;
        }> = {},
    ) => {
        setStage(
            pickNextStage({
                siteUrl: next.siteUrl !== undefined ? next.siteUrl : siteUrl,
                signerMode: next.signerMode !== undefined ? next.signerMode : signerMode,
                domainLabel: next.domainLabel !== undefined ? next.domainLabel : domainLabel,
                domainRaw: next.domainRaw !== undefined ? next.domainRaw : domainRaw,
                publishToPlayground:
                    next.publishToPlayground !== undefined
                        ? next.publishToPlayground
                        : publishToPlayground,
            }),
        );
    };

    // Compose the active signer for downstream stages. Memoised so the
    // ResolvedSigner identity stays stable across re-renders (the dev branch
    // would otherwise produce a fresh `createDevPublishSigner()` instance on
    // every render — fine functionally because `DEV_PUBLISH_ACCOUNT` is
    // module-scope, but it makes downstream effect dependencies look churny).
    const activeSigner = useMemo<ResolvedSigner | null>(() => {
        if (explicitSigner) return explicitSigner;
        if (signerMode === "phone") return sessionSigner;
        if (signerMode === "dev") return createDevPublishSigner();
        return null;
    }, [explicitSigner, signerMode, sessionSigner]);

    return (
        <Box flexDirection="column">
            <Header
                cmd="playground decentralize"
                subtitle={fullDomain ?? siteUrl ?? undefined}
                network={getNetworkLabel(env)}
                right={VERSION_LABEL}
            />

            {stage.kind === "prompt-url" && (
                <>
                    <Callout tone="warning" title="about this command">
                        <Text>
                            Mirrors a live static site (https URL) and republishes it as a .dot
                            site.
                        </Text>
                    </Callout>
                    <Input
                        label="site URL"
                        placeholder="example.com or https://you.github.io/site"
                        validate={validateSiteUrlInput}
                        onSubmit={(value) => {
                            setSiteUrl(value);
                            advance({ siteUrl: value });
                        }}
                    />
                </>
            )}

            {stage.kind === "prompt-signer" && (
                <Select<SignerMode>
                    label="signer"
                    options={signerOptions(sessionSigner)}
                    onSelect={(mode) => {
                        if (mode === "phone" && !sessionSigner) {
                            setStage({
                                kind: "error",
                                message:
                                    'No session found — run "playground init" to log in, then re-run, or pick the dev signer.',
                            });
                            return;
                        }
                        setSignerMode(mode);
                        advance({ signerMode: mode });
                    }}
                />
            )}

            {stage.kind === "prompt-domain" && (
                <Input
                    label="domain"
                    placeholder="leave blank to auto-generate from the URL"
                    prefill={domainRaw ?? ""}
                    externalError={domainError}
                    validate={validateDomainInput}
                    onSubmit={(value) => {
                        setDomainError(null);
                        setDomainRaw(value);
                        advance({ domainRaw: value });
                    }}
                />
            )}

            {stage.kind === "validate-domain" && (
                <ValidateDomainStage
                    raw={stage.raw}
                    env={env}
                    siteUrl={siteUrl!}
                    signer={activeSigner}
                    onResolved={({ label, fullDomain: full, note }) => {
                        setDomainLabel(label);
                        setFullDomain(full);
                        setAvailabilityNote(note);
                        setValidationMessage(null);
                        advance({ domainLabel: label });
                    }}
                    onFailed={(message) => {
                        setDomainError(message);
                        setDomainLabel(null);
                        setValidationMessage(null);
                        // Re-prompt: clear domainRaw so prompt-domain reopens.
                        setDomainRaw(null);
                        setStage({ kind: "prompt-domain" });
                    }}
                    onProgress={(message) => setValidationMessage(message)}
                    progressMessage={validationMessage}
                />
            )}

            {stage.kind === "prompt-publish" && (
                <Select<boolean>
                    label="publish to the playground registry?"
                    options={[
                        {
                            value: false,
                            label: "no",
                            hint: "just register the .dot name (DotNS only)",
                        },
                        {
                            value: true,
                            label: "yes",
                            hint: "list the mirrored site in the playground apps tab",
                        },
                    ]}
                    onSelect={(choice) => {
                        setPublishToPlayground(choice);
                        advance({ publishToPlayground: choice });
                    }}
                />
            )}

            {stage.kind === "confirm" && (
                <ConfirmStage
                    siteUrl={siteUrl!}
                    fullDomain={fullDomain!}
                    availabilityNote={availabilityNote}
                    signer={activeSigner!}
                    signerMode={signerMode!}
                    publishToPlayground={publishToPlayground === true}
                    onConfirm={() => setStage({ kind: "running" })}
                    onCancel={() => onDone({ kind: "cancel" })}
                />
            )}

            {stage.kind === "running" && (
                <RunningStage
                    siteUrl={siteUrl!}
                    label={domainLabel!}
                    fullDomain={fullDomain!}
                    mode={signerMode!}
                    userSigner={explicitSigner ?? sessionSigner}
                    publishToPlayground={publishToPlayground === true}
                    env={env}
                    onComplete={(outcome) => setStage({ kind: "done", outcome })}
                    onFailed={(message) => setStage({ kind: "error", message })}
                />
            )}

            {stage.kind === "done" && (
                <DoneStage
                    outcome={stage.outcome}
                    onExit={() => onDone({ kind: "success", outcome: stage.outcome })}
                />
            )}

            {stage.kind === "error" && (
                <ErrorStage
                    message={stage.message}
                    onExit={() => onDone({ kind: "error", message: stage.message })}
                />
            )}
        </Box>
    );
}

function signerOptions(sessionSigner: ResolvedSigner | null): SelectOption<SignerMode>[] {
    return [
        {
            value: "dev",
            label: "dev signer",
            hint: "fast, signs locally with the bulletin-deploy default account",
        },
        {
            value: "phone",
            label: "your phone signer",
            hint: sessionSigner
                ? "signed with your logged-in account"
                : "requires `playground init` first",
        },
    ];
}

// ── Validate-domain stage ────────────────────────────────────────────────────

function ValidateDomainStage({
    raw,
    env,
    siteUrl,
    signer,
    progressMessage,
    onResolved,
    onFailed,
    onProgress,
}: {
    raw: string;
    env: Env;
    siteUrl: string;
    signer: ResolvedSigner | null;
    progressMessage: string | null;
    onResolved: (result: { label: string; fullDomain: string; note: string | null }) => void;
    onFailed: (message: string) => void;
    onProgress: (message: string) => void;
}) {
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const result = await resolveDomain({
                    env,
                    providedDot: raw || null,
                    siteUrl,
                    signer,
                    onMessage: (m) => {
                        if (!cancelled) onProgress(m.trim());
                    },
                });
                if (!cancelled) onResolved(result);
            } catch (err) {
                if (!cancelled) onFailed(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            cancelled = true;
        };
        // We intentionally key on `raw` only — `signer`/`siteUrl` are stable
        // for the lifetime of a single validate stage.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [raw]);

    return (
        <Box flexDirection="column">
            <Row
                mark="run"
                label={progressMessage ?? `checking ${raw || "auto-generated name"}…`}
            />
        </Box>
    );
}

// ── Confirm stage ────────────────────────────────────────────────────────────

function ConfirmStage({
    siteUrl,
    fullDomain,
    availabilityNote,
    signer,
    signerMode,
    publishToPlayground,
    onConfirm,
    onCancel,
}: {
    siteUrl: string;
    fullDomain: string;
    availabilityNote: string | null;
    signer: ResolvedSigner;
    signerMode: SignerMode;
    publishToPlayground: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <Box flexDirection="column">
            <Section title={`decentralizing ${fullDomain}`}>
                <Row label="site" value={siteUrl} />
                <Row label="domain" value={`${fullDomain}.li`} />
                <Row
                    label="signer"
                    value={`${signerMode} · ${signer.address}`}
                    tone={signerMode === "phone" ? "accent" : "default"}
                />
                <Row
                    label="playground"
                    value={publishToPlayground ? "publish to apps tab" : "skip"}
                    tone={publishToPlayground ? "accent" : "muted"}
                />
                {availabilityNote && <Row label="note" value={availabilityNote} tone="warning" />}
            </Section>
            <Select<"go" | "cancel">
                label="proceed?"
                options={[
                    {
                        value: "go",
                        label: "yes, decentralize it",
                        hint: publishToPlayground
                            ? "mirror + upload + register + publish"
                            : "mirror + upload + register",
                    },
                    { value: "cancel", label: "cancel", hint: "exit without changes" },
                ]}
                onSelect={(choice) => (choice === "go" ? onConfirm() : onCancel())}
            />
        </Box>
    );
}

// ── Running stage ────────────────────────────────────────────────────────────

type StepStatus = "idle" | "running" | "complete";

function stepMark(status: StepStatus): MarkKind {
    switch (status) {
        case "complete":
            return "ok";
        case "running":
            return "run";
        default:
            return "idle";
    }
}

function RunningStage({
    siteUrl,
    label,
    fullDomain,
    mode,
    userSigner,
    publishToPlayground,
    env,
    onComplete,
    onFailed,
}: {
    siteUrl: string;
    label: string;
    fullDomain: string;
    mode: SignerMode;
    userSigner: ResolvedSigner | null;
    publishToPlayground: boolean;
    env: Env;
    onComplete: (outcome: DecentralizeOutcome) => void;
    onFailed: (message: string) => void;
}) {
    const [mirrorStatus, setMirrorStatus] = useState<StepStatus>("running");
    const [uploadStatus, setUploadStatus] = useState<StepStatus>("idle");
    const [playgroundStatus, setPlaygroundStatus] = useState<StepStatus>("idle");
    const [latestLog, setLatestLog] = useState<string | null>(null);
    // Active "check your phone" prompt — set on sign-request, cleared on
    // sign-complete / sign-error. Only ever populated in phone mode.
    const [signingPrompt, setSigningPrompt] = useState<SigningEvent | null>(null);

    // Throttle the latest-log line to ≤10 Hz. bulletin-deploy emits per-chunk
    // events in bursts; setState-per-event floods Ink's reconciler (see
    // CLAUDE.md "Throttle TUI info updates"). We keep only the most recent
    // line — it's a status indicator, not a scrollback.
    const pendingRef = useRef<string | null>(null);
    const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const queueLog = (line: string) => {
        pendingRef.current = line.length > 160 ? `${line.slice(0, 159)}…` : line;
        if (flushTimer.current) return;
        flushTimer.current = setTimeout(() => {
            if (pendingRef.current !== null) {
                setLatestLog(pendingRef.current);
                pendingRef.current = null;
            }
            flushTimer.current = null;
        }, 100);
    };

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const outcome = await runDecentralize({
                    siteUrl,
                    label,
                    fullDomain,
                    mode,
                    userSigner,
                    publishToPlayground,
                    env,
                    onEvent: (event) => {
                        switch (event.kind) {
                            case "mirror-start":
                                setMirrorStatus("running");
                                queueLog(`mirroring ${event.url}`);
                                break;
                            case "mirror-line":
                                queueLog(event.line);
                                break;
                            case "mirror-done":
                                setMirrorStatus("complete");
                                setUploadStatus("running");
                                queueLog(`mirrored ${event.fileCount} files`);
                                break;
                            case "storage-start":
                                setUploadStatus("running");
                                break;
                            case "storage-event": {
                                const line = describeDeployEvent(event.event);
                                if (line) queueLog(line);
                                break;
                            }
                            case "storage-done":
                                setUploadStatus("complete");
                                queueLog(`registered ${fullDomain}`);
                                break;
                            case "playground-start":
                                setPlaygroundStatus("running");
                                break;
                            case "playground-event": {
                                const line = describeDeployEvent(event.event);
                                if (line) queueLog(line);
                                break;
                            }
                            case "playground-done":
                                setPlaygroundStatus("complete");
                                break;
                            case "signing":
                                if (event.event.kind === "sign-request") {
                                    setSigningPrompt(event.event);
                                } else if (event.event.kind === "sign-complete") {
                                    setSigningPrompt(null);
                                } else if (event.event.kind === "sign-error") {
                                    setSigningPrompt(null);
                                    queueLog(`signing failed: ${event.event.message}`);
                                }
                                break;
                        }
                    },
                });
                if (!cancelled) onComplete(outcome);
            } catch (err) {
                if (!cancelled) onFailed(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            cancelled = true;
            if (flushTimer.current) {
                clearTimeout(flushTimer.current);
                flushTimer.current = null;
            }
        };
        // The pipeline is keyed on the inputs frozen at confirm time; we
        // never re-run it within a single mount.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const running =
        mirrorStatus === "running" || uploadStatus === "running" || playgroundStatus === "running";

    return (
        <Box flexDirection="column">
            <Section title={`decentralizing ${fullDomain}`} gapBelow={false}>
                <Row mark={stepMark(mirrorStatus)} label="mirror" tone="muted" />
                <Row mark={stepMark(uploadStatus)} label="upload + dotns" tone="muted" />
                {publishToPlayground && (
                    <Row
                        mark={stepMark(playgroundStatus)}
                        label="publish to playground"
                        tone="muted"
                    />
                )}
                {running && latestLog && <Hint indent={2}>{latestLog}</Hint>}
            </Section>

            {signingPrompt && signingPrompt.kind === "sign-request" && (
                <PhoneApprovalCallout
                    step={signingPrompt.step}
                    total={signingPrompt.total}
                    label={signingPrompt.label}
                />
            )}
        </Box>
    );
}

// ── Done stage ───────────────────────────────────────────────────────────────

function DoneStage({
    outcome,
    onExit,
}: {
    outcome: DecentralizeOutcome;
    onExit: () => void;
}) {
    // Auto-exit: the rendered frame stays in terminal scrollback, so users
    // see the summary without having to press a key. Matches the implicit
    // "command finishes when work finishes" convention every other CLI uses.
    useEffect(() => {
        onExit();
        // onExit is captured at mount; we never want to re-fire on identity churn.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <Box flexDirection="column">
            <Row mark="ok" label="decentralized!" />
            <Section gapBelow={false}>
                <Row label="url" value={outcome.appUrl} />
                <Row label="domain" value={outcome.fullDomain} />
                <Row label="ipfs cid" value={outcome.ipfsCid} />
                <Row label="gateway" value={outcome.gatewayUrl} />
                {outcome.metadataCid && <Row label="metadata cid" value={outcome.metadataCid} />}
            </Section>
            {outcome.signerSource === "dev" && (
                <Callout tone="warning" title="owned by a development account">
                    <Text>
                        To deploy to a domain owned by you, run `playground init` and re-run
                        `playground decentralize` with the mobile signer.
                    </Text>
                </Callout>
            )}
        </Box>
    );
}

// ── Error stage ──────────────────────────────────────────────────────────────

function ErrorStage({ message, onExit }: { message: string; onExit: () => void }) {
    // Same auto-exit rationale as DoneStage — the danger callout stays in
    // scrollback so the user can still read it after the prompt returns.
    useEffect(() => {
        onExit();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <Box flexDirection="column">
            <Callout tone="danger" title="decentralize failed">
                <Text>{message}</Text>
            </Callout>
        </Box>
    );
}
