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

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
    Header,
    Row,
    Section,
    Hint,
    Callout,
    PhoneApprovalCallout,
    Sparkline,
    Select,
    Input,
    setWindowTitle,
    type MarkKind,
} from "../../utils/ui/theme/index.js";
import {
    resolveSignerSetup,
    DEV_PUBLISH_ADDRESS,
    type SignerMode,
    type DeployApproval,
} from "../../utils/deploy/signerMode.js";
import {
    checkDomainAvailability,
    formatAvailability,
    type AvailabilityResult,
    type DeployPlan,
} from "../../utils/deploy/availability.js";
import { readReadme, README_CAP_BYTES } from "../../utils/deploy/playground.js";
import type { DeployEvent, DeployOutcome } from "../../utils/deploy/run.js";
import type { SigningEvent } from "../../utils/deploy/signingProxy.js";
import { buildSummaryView } from "./summary.js";
import {
    initialRunningState,
    runningReducer,
    type FrontendSectionState,
    type StepStatus,
} from "./runningState.js";
import type { ResolvedSigner } from "../../utils/signer.js";
import { DEFAULT_BUILD_DIR, getNetworkLabel } from "../../config.js";
import { VERSION_LABEL } from "../../utils/version.js";
import { ensureGitInstalled, resolveRepositoryUrl } from "../../utils/deploy/moddable.js";

export interface DeployScreenInputs {
    projectDir: string;
    domain: string | null;
    buildDir: string | null;
    mode: SignerMode | null;
    publishToPlayground: boolean | null;
    /** Publish to the playground with private visibility. Not interactively prompted — set via `--private`. */
    playgroundPrivate: boolean;
    skipBuild: boolean | null;
    /** Pre-set moddable from `--moddable` / `--no-moddable`. null = ask. */
    moddable: boolean | null;
    userSigner: ResolvedSigner | null;
    onDone: (outcome: DeployOutcome | null) => void;
}

export type Stage =
    | { kind: "prompt-build" }
    | { kind: "prompt-signer" }
    | { kind: "prompt-buildDir" }
    | { kind: "prompt-domain" }
    | { kind: "validate-domain"; domain: string }
    | { kind: "prompt-publish" }
    | { kind: "prompt-moddable" }
    | { kind: "moddable-preflight" }
    | { kind: "moddable-error"; message: string }
    | { kind: "confirm" }
    | { kind: "running" }
    | { kind: "done"; outcome: DeployOutcome }
    | { kind: "error"; message: string };

interface Resolved {
    mode: SignerMode;
    buildDir: string;
    domain: string;
    publishToPlayground: boolean;
    skipBuild: boolean;
    moddable: boolean;
    repositoryUrl: string | null;
}

export function DeployScreen({
    projectDir,
    domain: initialDomain,
    buildDir: initialBuildDir,
    mode: initialMode,
    publishToPlayground: initialPublish,
    playgroundPrivate,
    skipBuild: initialSkipBuild,
    moddable: initialModdable,
    userSigner,
    onDone,
}: DeployScreenInputs) {
    const [mode, setMode] = useState<SignerMode | null>(initialMode);
    const [buildDir, setBuildDir] = useState<string | null>(initialBuildDir);
    const [domain, setDomain] = useState<string | null>(initialDomain);
    const [publishToPlayground, setPublishToPlayground] = useState<boolean | null>(initialPublish);
    const [skipBuild, setSkipBuild] = useState<boolean | null>(initialSkipBuild);
    const [moddable, setModdable] = useState<boolean | null>(initialModdable);
    const [repositoryUrl, setRepositoryUrl] = useState<string | null>(null);
    const [domainError, setDomainError] = useState<string | null>(null);
    // Captured from the availability check; feeds `resolveSignerSetup` so
    // the summary card shows the correct phone-approval count (register +
    // PoP upgrade = 4 DotNS taps, vs register alone = 3, vs update = 1).
    const [plan, setPlan] = useState<DeployPlan | null>(null);
    const [stage, setStage] = useState<Stage>(() =>
        pickInitialStage(
            initialSkipBuild,
            initialMode,
            initialBuildDir,
            initialDomain,
            initialPublish,
            initialModdable,
            null,
        ),
    );

    // Passed down to RunningStage; read back on completion for the sparkline.
    // Ref instead of state so the high-frequency chunk-progress stream doesn't
    // force re-renders of the whole DeployScreen.
    const finalChunkTimingsRef = useRef<number[]>([]);

    const advance = (
        nextSkipBuild: boolean | null = skipBuild,
        nextMode: SignerMode | null = mode,
        nextBuildDir: string | null = buildDir,
        nextDomain: string | null = domain,
        nextPublish: boolean | null = publishToPlayground,
        nextModdable: boolean | null = moddable,
        nextRepoUrl: string | null = repositoryUrl,
    ) => {
        const s = pickNextStage(
            nextSkipBuild,
            nextMode,
            nextBuildDir,
            nextDomain,
            nextPublish,
            nextModdable,
            nextRepoUrl,
        );
        setStage(s);
    };

    const resolved = useMemo<Resolved | null>(() => {
        if (
            mode === null ||
            buildDir === null ||
            domain === null ||
            publishToPlayground === null ||
            skipBuild === null ||
            moddable === null
        )
            return null;
        return {
            mode,
            buildDir,
            domain,
            publishToPlayground,
            skipBuild,
            moddable,
            repositoryUrl,
        };
    }, [mode, buildDir, domain, publishToPlayground, skipBuild, moddable, repositoryUrl]);

    // Dynamic terminal tab title: subtitle becomes the domain once we know it.
    const headerSubtitle = resolved?.domain ?? domain ?? undefined;

    return (
        <Box flexDirection="column">
            <Header
                cmd="dot deploy"
                subtitle={headerSubtitle}
                network={getNetworkLabel()}
                right={VERSION_LABEL}
            />

            {stage.kind === "prompt-build" && (
                <Select<boolean>
                    label="build before deploy?"
                    options={[
                        { value: false, label: "yes", hint: "rebuild the project" },
                        { value: true, label: "no", hint: "use existing build in buildDir" },
                    ]}
                    initialIndex={0}
                    onSelect={(skip) => {
                        setSkipBuild(skip);
                        advance(skip);
                    }}
                />
            )}

            {stage.kind === "prompt-signer" && (
                <Select<SignerMode>
                    label="signer"
                    options={[
                        {
                            value: "dev",
                            label: "dev signer",
                            hint: "fast, 0 phone taps for upload",
                        },
                        {
                            value: "phone",
                            label: "your phone signer",
                            hint: "signed with your logged-in account",
                        },
                    ]}
                    onSelect={(m) => {
                        setMode(m);
                        advance(skipBuild, m);
                    }}
                />
            )}

            {stage.kind === "prompt-buildDir" && (
                <Input
                    label="build directory"
                    initial={DEFAULT_BUILD_DIR}
                    onSubmit={(v) => {
                        setBuildDir(v);
                        advance(skipBuild, mode, v);
                    }}
                />
            )}

            {stage.kind === "prompt-domain" && (
                <Input
                    label="domain"
                    placeholder="my-app"
                    prefill={domain ?? ""}
                    externalError={domainError}
                    validate={(v) =>
                        /^[a-z0-9][a-z0-9-]*(\.dot)?$/i.test(v.trim())
                            ? null
                            : "use lowercase letters, digits, and dashes"
                    }
                    onSubmit={(v) => {
                        const trimmed = v.trim();
                        setDomain(trimmed);
                        setDomainError(null);
                        setStage({ kind: "validate-domain", domain: trimmed });
                    }}
                />
            )}

            {stage.kind === "validate-domain" && (
                <ValidateDomainStage
                    domain={stage.domain}
                    ownerSs58Address={
                        mode === "phone"
                            ? userSigner?.address
                            : userSigner?.source === "dev"
                              ? userSigner.address
                              : DEV_PUBLISH_ADDRESS
                    }
                    onAvailable={(result) => {
                        setDomain(result.fullDomain);
                        setPlan(result.plan);
                        advance(skipBuild, mode, buildDir, result.fullDomain);
                    }}
                    onUnavailable={(reason) => {
                        setDomainError(reason);
                        setStage({ kind: "prompt-domain" });
                    }}
                />
            )}

            {stage.kind === "prompt-publish" && (
                <Select<boolean>
                    label="publish to the playground?"
                    options={[
                        { value: false, label: "no", hint: "DotNS only" },
                        { value: true, label: "yes", hint: "publish to the playground registry" },
                    ]}
                    initialIndex={0}
                    onSelect={(yes) => {
                        setPublishToPlayground(yes);
                        if (!yes) setModdable(false);
                        advance(skipBuild, mode, buildDir, domain, yes, yes ? moddable : false);
                    }}
                />
            )}

            {stage.kind === "prompt-moddable" && (
                <Select<boolean>
                    label="make this app moddable? (anyone in the playground can dot mod it)"
                    options={[
                        {
                            value: false,
                            label: "no",
                            hint: "metadata will not include a source repo",
                        },
                        { value: true, label: "yes", hint: "publishes your source repo URL" },
                    ]}
                    initialIndex={0}
                    onSelect={(yes) => {
                        setModdable(yes);
                        if (yes) {
                            setStage({ kind: "moddable-preflight" });
                        } else {
                            advance(skipBuild, mode, buildDir, domain, publishToPlayground, false);
                        }
                    }}
                />
            )}

            {stage.kind === "moddable-preflight" && (
                <ModdablePreflightStage
                    projectDir={projectDir}
                    onResolved={(url) => {
                        setRepositoryUrl(url);
                        advance(skipBuild, mode, buildDir, domain, publishToPlayground, true, url);
                    }}
                    onError={(msg) => {
                        setStage({ kind: "moddable-error", message: msg });
                    }}
                />
            )}

            {stage.kind === "moddable-error" && (
                <ModdableErrorStage message={stage.message} onExit={() => onDone(null)} />
            )}

            {stage.kind === "confirm" && resolved && (
                <ConfirmStage
                    projectDir={projectDir}
                    inputs={resolved}
                    userSigner={userSigner}
                    plan={plan}
                    onProceed={() => setStage({ kind: "running" })}
                    onCancel={() => {
                        onDone(null);
                    }}
                />
            )}

            {resolved &&
                (stage.kind === "running" || stage.kind === "done" || stage.kind === "error") && (
                    <RunningStage
                        projectDir={projectDir}
                        inputs={resolved}
                        playgroundPrivate={playgroundPrivate}
                        userSigner={userSigner}
                        plan={plan}
                        onFinish={(outcome, chunkTimings) => {
                            setStage({ kind: "done", outcome });
                            // Surface completion on the terminal tab so users can glance over.
                            setWindowTitle(`dot deploy · ${resolved.domain} · ✓`);
                            onDone(outcome);
                            // chunkTimings is threaded via ref below — consumed by FinalResult.
                            finalChunkTimingsRef.current = chunkTimings;
                        }}
                        onError={(message) => {
                            setStage({ kind: "error", message });
                            setWindowTitle(`dot deploy · ${resolved.domain} · ✕`);
                            onDone(null);
                        }}
                    />
                )}

            {stage.kind === "done" && (
                <FinalResult outcome={stage.outcome} chunkTimings={finalChunkTimingsRef.current} />
            )}

            {stage.kind === "error" && (
                <Section>
                    <Row mark="fail" label="deploy failed" value={stage.message} tone="danger" />
                </Section>
            )}
        </Box>
    );
}

// ── Stage pickers ────────────────────────────────────────────────────────────

function pickInitialStage(
    skipBuild: boolean | null,
    mode: SignerMode | null,
    buildDir: string | null,
    domain: string | null,
    publish: boolean | null,
    moddable: boolean | null,
    repositoryUrl: string | null,
): Stage {
    return pickNextStage(skipBuild, mode, buildDir, domain, publish, moddable, repositoryUrl);
}

export function pickNextStage(
    skipBuild: boolean | null,
    mode: SignerMode | null,
    buildDir: string | null,
    domain: string | null,
    publish: boolean | null,
    moddable: boolean | null,
    repositoryUrl: string | null,
): Stage {
    if (skipBuild === null) return { kind: "prompt-build" };
    if (mode === null) return { kind: "prompt-signer" };
    if (buildDir === null) return { kind: "prompt-buildDir" };
    if (domain === null) return { kind: "prompt-domain" };
    if (publish === null) return { kind: "prompt-publish" };
    if (publish && moddable === null) return { kind: "prompt-moddable" };
    // --moddable=true via flag: skip the prompt and drive into the preflight.
    if (publish && moddable === true && repositoryUrl === null) {
        return { kind: "moddable-preflight" };
    }
    return { kind: "confirm" };
}

// ── Moddable preflight ────────────────────────────────────────────────────────

function ModdablePreflightStage({
    projectDir,
    onResolved,
    onError,
}: {
    projectDir: string;
    onResolved: (url: string) => void;
    onError: (message: string) => void;
}) {
    const [status, setStatus] = useState<string>("checking git…");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                setStatus("ensuring git is installed…");
                await ensureGitInstalled();
                if (cancelled) return;

                setStatus("resolving repository…");
                const url = await resolveRepositoryUrl({
                    cwd: projectDir,
                    onLog: (line) => {
                        if (!cancelled) setStatus(line);
                    },
                });
                if (cancelled) return;
                onResolved(url);
            } catch (err) {
                if (cancelled) return;
                onError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [projectDir]);

    return (
        <Section>
            <Row mark="run" label={status} tone="muted" />
        </Section>
    );
}

/**
 * Formal warning stage shown when the moddable preflight cannot proceed —
 * almost always because the user hasn't set up a public GitHub `origin` yet.
 * Renders the actionable error inside a yellow Callout (matching the
 * "check your phone" banner) so it visually registers as a setup requirement
 * rather than a deploy crash. Pressing Enter or Esc exits the deploy.
 */
function ModdableErrorStage({ message, onExit }: { message: string; onExit: () => void }) {
    useInput((_input, key) => {
        if (key.return || key.escape) onExit();
    });
    return (
        <Box flexDirection="column">
            <Callout tone="warning" title="moddable setup needed">
                <Text>{message}</Text>
            </Callout>
            <Box marginTop={1}>
                <Hint>{"enter or esc to exit"}</Hint>
            </Box>
        </Box>
    );
}

// ── Domain validation ────────────────────────────────────────────────────────

function ValidateDomainStage({
    domain,
    ownerSs58Address,
    onAvailable,
    onUnavailable,
}: {
    domain: string;
    ownerSs58Address: string | undefined;
    onAvailable: (result: AvailabilityResult & { status: "available" }) => void;
    onUnavailable: (reason: string) => void;
}) {
    const [status, setStatus] = useState<"checking" | "done" | "error">("checking");
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const result = await checkDomainAvailability(domain, { ownerSs58Address });
                if (cancelled) return;
                if (result.status === "available") {
                    setStatus("done");
                    setMessage(formatAvailability(result));
                    // Short hold so users can read any note (e.g. "PoP will
                    // be set up automatically") before the next prompt mounts.
                    setTimeout(
                        () => {
                            if (!cancelled) onAvailable(result);
                        },
                        result.note ? 1200 : 300,
                    );
                } else {
                    const reason = formatAvailability(result);
                    setStatus("error");
                    setMessage(reason);
                    setTimeout(() => {
                        if (!cancelled) onUnavailable(reason);
                    }, 600);
                }
            } catch (err) {
                if (cancelled) return;
                const msg = err instanceof Error ? err.message : String(err);
                setStatus("error");
                setMessage(`availability check failed: ${msg}`);
                setTimeout(() => {
                    if (!cancelled) onUnavailable(msg);
                }, 600);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [domain]);

    const mark: MarkKind = status === "checking" ? "run" : status === "done" ? "ok" : "fail";
    const label = status === "checking" ? `checking ${domain}` : (message ?? "");
    return (
        <Section>
            <Row mark={mark} label={label} tone={status === "error" ? "danger" : "muted"} />
        </Section>
    );
}

// ── Confirm stage ────────────────────────────────────────────────────────────

function ConfirmStage({
    projectDir,
    inputs,
    userSigner,
    plan,
    onProceed,
    onCancel,
}: {
    projectDir: string;
    inputs: Resolved;
    userSigner: ResolvedSigner | null;
    plan: DeployPlan | null;
    onProceed: () => void;
    onCancel: () => void;
}) {
    const setup = useMemo(() => {
        try {
            return resolveSignerSetup({
                mode: inputs.mode,
                userSigner,
                publishToPlayground: inputs.publishToPlayground,
                plan: plan ?? undefined,
            });
        } catch (err) {
            return {
                approvals: [] as DeployApproval[],
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }, [inputs, userSigner, plan]);

    // Only warn on the oversized branch — silent when README is absent or
    // within the cap, per the product decision to inline tacitly and speak
    // up only when we're dropping content the user expected to ship.
    const oversizedReadme = useMemo(() => {
        if (!inputs.publishToPlayground) return null;
        const status = readReadme(projectDir);
        return status.kind === "oversized" ? status : null;
    }, [projectDir, inputs.publishToPlayground]);

    const view = buildSummaryView({
        mode: inputs.mode,
        domain: inputs.domain.replace(/\.dot$/, "") + ".dot",
        buildDir: inputs.buildDir,
        skipBuild: inputs.skipBuild,
        publishToPlayground: inputs.publishToPlayground,
        moddable: inputs.moddable,
        repositoryUrl: inputs.repositoryUrl,
        approvals: "approvals" in setup ? setup.approvals : [],
        // What we show in the "Signer" row reflects who actually submits
        // the on-chain txs, which is mostly setup.publishSigner — that's
        // either the user's session (phone mode), the user's SURI account
        // (dev + --suri), or a synthesised Alice for dev + session / pure
        // dev. For non-playground deploys we fall back to userSigner.
        signerAddress:
            "publishSigner" in setup && setup.publishSigner
                ? setup.publishSigner.address
                : inputs.mode === "phone" || userSigner?.source === "dev"
                  ? userSigner?.address
                  : undefined,
        claimedOwnerH160: "claimedOwnerH160" in setup ? setup.claimedOwnerH160 : undefined,
    });

    useInput((_input, key) => {
        if (key.return) onProceed();
        if (key.escape) onCancel();
    });

    return (
        <Box flexDirection="column">
            <Section title={view.headline.toLowerCase()}>
                {view.rows.map((row) => (
                    <Row
                        key={row.label}
                        label={row.label.toLowerCase()}
                        value={row.value}
                        tone="default"
                    />
                ))}
            </Section>

            <Section>
                {view.totalApprovals === 0 ? (
                    <Row label="phone approvals" value="none" tone="muted" />
                ) : (
                    <>
                        <Row
                            label="phone approvals"
                            value={String(view.totalApprovals)}
                            tone="accent"
                        />
                        {view.approvalLines.map((line) => (
                            <Hint key={line} indent={2}>
                                {line}
                            </Hint>
                        ))}
                    </>
                )}
            </Section>

            {oversizedReadme && (
                <Callout tone="warning" title="readme will not be uploaded">
                    <Text>
                        README.md is {formatKbCeil(oversizedReadme.size)} — over the{" "}
                        {README_CAP_BYTES / 1024} KB limit. the rest of the deploy will continue
                        without it.
                    </Text>
                </Callout>
            )}

            <Hint>{"enter to deploy  ·  esc to cancel"}</Hint>

            {"error" in setup && setup.error && (
                <Callout tone="warning">
                    <Text>{setup.error}</Text>
                </Callout>
            )}
        </Box>
    );
}

// ── Running stage ────────────────────────────────────────────────────────────

function stepMark(status: StepStatus): MarkKind {
    switch (status) {
        case "complete":
            return "ok";
        case "running":
            return "run";
        case "error":
            return "fail";
        default:
            return "idle";
    }
}

function RunningStage({
    projectDir,
    inputs,
    playgroundPrivate,
    userSigner,
    plan,
    onFinish,
    onError,
}: {
    projectDir: string;
    inputs: Resolved;
    playgroundPrivate: boolean;
    userSigner: ResolvedSigner | null;
    plan: DeployPlan | null;
    onFinish: (outcome: DeployOutcome, chunkTimings: number[]) => void;
    onError: (message: string) => void;
}) {
    const [runningState, setRunningState] = useState(() =>
        initialRunningState({
            skipBuild: inputs.skipBuild,
            publishToPlayground: inputs.publishToPlayground,
        }),
    );
    const frontendState = runningState.frontend;
    const playgroundState = runningState.playground;
    const [signingPrompt, setSigningPrompt] = useState<SigningEvent | null>(null);

    // Per-chunk timing for the sparkline on completion. Held in refs to avoid
    // re-renders on every chunk tick.
    const chunkTimingsRef = useRef<number[]>([]);
    const lastChunkAtRef = useRef<number | null>(null);

    // Flush each section's latest-line row at ≤10 Hz — see CLAUDE.md
    // "Throttle TUI info updates" for the incident that made this mandatory.
    const INFO_THROTTLE_MS = 100;
    const INFO_MAX_LEN = 160;
    const frontendPendingRef = useRef<string | null>(null);
    const frontendTimerRef = useRef<NodeJS.Timeout | null>(null);
    const queueFrontendLog = (line: string) => {
        const truncated = line.length > INFO_MAX_LEN ? `${line.slice(0, INFO_MAX_LEN - 1)}…` : line;
        frontendPendingRef.current = truncated;
        if (frontendTimerRef.current === null) {
            frontendTimerRef.current = setTimeout(() => {
                if (frontendPendingRef.current !== null) {
                    const v = frontendPendingRef.current;
                    frontendPendingRef.current = null;
                    setRunningState((s) => ({
                        ...s,
                        frontend: { ...s.frontend, latestLog: v },
                    }));
                }
                frontendTimerRef.current = null;
            }, INFO_THROTTLE_MS);
        }
    };

    useEffect(() => {
        // Announce the command + target in the terminal tab on mount.
        setWindowTitle(`dot deploy · ${inputs.domain} · building`);

        let cancelled = false;

        (async () => {
            try {
                const { runDeploy } = await import("../../utils/deploy/run.js");
                const outcome = await runDeploy({
                    projectDir,
                    buildDir: inputs.buildDir,
                    skipBuild: inputs.skipBuild,
                    domain: inputs.domain,
                    mode: inputs.mode,
                    publishToPlayground: inputs.publishToPlayground,
                    playgroundPrivate,
                    moddable: inputs.moddable,
                    repositoryUrl: inputs.repositoryUrl,
                    userSigner,
                    plan: plan ?? undefined,
                    onEvent: (event) => handleEvent(event),
                });
                if (!cancelled) onFinish(outcome, chunkTimingsRef.current);
            } catch (err) {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : String(err);
                    onError(message);
                }
            }
        })();

        function handleEvent(event: DeployEvent) {
            setRunningState((s) => runningReducer(s, event));
            if (event.kind === "phase-start") {
                if (event.phase === "build") {
                    setWindowTitle(`dot deploy · ${inputs.domain} · building`);
                } else if (event.phase === "storage-and-dotns") {
                    setWindowTitle(`dot deploy · ${inputs.domain} · uploading`);
                } else if (event.phase === "playground") {
                    setWindowTitle(`dot deploy · ${inputs.domain} · publishing`);
                }
            } else if (event.kind === "build-log") {
                queueFrontendLog(event.line);
            } else if (event.kind === "build-detected") {
                queueFrontendLog(`> ${event.config.description}`);
            } else if (event.kind === "storage-event") {
                if (event.event.kind === "chunk-progress") {
                    const now = performance.now();
                    const last = lastChunkAtRef.current;
                    if (last !== null) {
                        chunkTimingsRef.current.push(now - last);
                    }
                    lastChunkAtRef.current = now;
                    queueFrontendLog(`uploading chunk ${event.event.current}/${event.event.total}`);
                } else if (event.event.kind === "info") {
                    queueFrontendLog(event.event.message);
                }
            } else if (event.kind === "signing") {
                if (event.event.kind === "sign-request") {
                    setSigningPrompt(event.event);
                } else if (event.event.kind === "sign-complete") {
                    setSigningPrompt(null);
                } else if (event.event.kind === "sign-error") {
                    setSigningPrompt(null);
                    queueFrontendLog(`signing failed: ${event.event.message}`);
                }
            }
        }

        return () => {
            cancelled = true;
            if (frontendTimerRef.current !== null) {
                clearTimeout(frontendTimerRef.current);
                frontendTimerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <Box flexDirection="column">
            <FrontendSectionView state={frontendState} />
            {playgroundState.status !== "skipped" && (
                <Box marginTop={1}>
                    <Row
                        mark={stepMark(playgroundState.status)}
                        label="publish to playground"
                        tone={playgroundState.status === "error" ? "danger" : "muted"}
                    />
                </Box>
            )}

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

function FrontendSectionView({ state }: { state: FrontendSectionState }) {
    const running = state.buildStatus === "running" || state.uploadStatus === "running";
    return (
        <Section title="frontend" gapBelow={false}>
            <Row
                mark={stepMark(state.buildStatus)}
                label="build"
                value={state.buildStatus === "skipped" ? "skipped" : undefined}
                tone={state.buildStatus === "error" ? "danger" : "muted"}
            />
            <Row
                mark={stepMark(state.uploadStatus)}
                label="upload + dotns"
                tone={state.uploadStatus === "error" ? "danger" : "muted"}
            />
            {running && state.latestLog && <Hint indent={2}>{truncate(state.latestLog, 120)}</Hint>}
        </Section>
    );
}

// ── Final result ─────────────────────────────────────────────────────────────

function FinalResult({
    outcome,
    chunkTimings,
}: {
    outcome: DeployOutcome;
    chunkTimings: number[];
}) {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Row mark="ok" label="deploy complete" tone="default" />

            <Box marginTop={1}>
                <Section gapBelow={false}>
                    <Row label="url" value={outcome.appUrl} />
                    <Row label="domain" value={outcome.fullDomain} />
                    <Row label="app cid" value={outcome.appCid} />
                    {outcome.ipfsCid && <Row label="ipfs cid" value={outcome.ipfsCid} />}
                    {outcome.metadataCid && (
                        <Row label="metadata cid" value={outcome.metadataCid} />
                    )}
                </Section>
            </Box>

            {chunkTimings.length > 0 && (
                <Box paddingLeft={2} flexDirection="row">
                    <Text>{"chunks".padEnd(14)}</Text>
                    <Sparkline values={chunkTimings} width={16} />
                    <Text dimColor>
                        {`  ${chunkTimings.length + 1} chunks  ·  avg ${(
                            average(chunkTimings) / 1000
                        ).toFixed(2)}s/chunk`}
                    </Text>
                </Box>
            )}
        </Box>
    );
}

function truncate(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function average(xs: number[]): number {
    if (xs.length === 0) return 0;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Round UP to the nearest 0.1 KB when displaying an oversized file, so a
// file 1 byte over a round-number cap never reads as "20.0 KB — over the
// 20 KB limit". Worst case we overstate by ~100 bytes, which is fine in a
// warning already saying the file is being dropped.
function formatKbCeil(bytes: number): string {
    const tenths = Math.ceil((bytes / 1024) * 10) / 10;
    return `${tenths.toFixed(1)} KB`;
}
