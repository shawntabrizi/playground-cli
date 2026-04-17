import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { Spinner, Done, Failed, Warning } from "../../utils/ui/index.js";
import {
    runDeploy,
    resolveSignerSetup,
    checkDomainAvailability,
    formatAvailability,
    type AvailabilityResult,
    type DeployEvent,
    type DeployOutcome,
    type DeployPhase,
    type SignerMode,
    type DeployApproval,
    type SigningEvent,
} from "../../utils/deploy/index.js";
import { buildSummaryView } from "./summary.js";
import type { ResolvedSigner } from "../../utils/signer.js";
import { DEFAULT_BUILD_DIR } from "../../config.js";

export interface DeployScreenInputs {
    projectDir: string;
    domain: string | null;
    buildDir: string | null;
    mode: SignerMode | null;
    publishToPlayground: boolean | null;
    userSigner: ResolvedSigner | null;
    onDone: (outcome: DeployOutcome | null) => void;
}

type Stage =
    | { kind: "prompt-signer" }
    | { kind: "prompt-buildDir" }
    | { kind: "prompt-domain" }
    | { kind: "validate-domain"; domain: string }
    | { kind: "prompt-publish" }
    | { kind: "confirm" }
    | { kind: "running" }
    | { kind: "done"; outcome: DeployOutcome }
    | { kind: "error"; message: string };

interface Resolved {
    mode: SignerMode;
    buildDir: string;
    domain: string;
    publishToPlayground: boolean;
}

export function DeployScreen({
    projectDir,
    domain: initialDomain,
    buildDir: initialBuildDir,
    mode: initialMode,
    publishToPlayground: initialPublish,
    userSigner,
    onDone,
}: DeployScreenInputs) {
    const [mode, setMode] = useState<SignerMode | null>(initialMode);
    const [buildDir, setBuildDir] = useState<string | null>(initialBuildDir);
    const [domain, setDomain] = useState<string | null>(initialDomain);
    const [publishToPlayground, setPublishToPlayground] = useState<boolean | null>(initialPublish);
    const [domainError, setDomainError] = useState<string | null>(null);
    const [stage, setStage] = useState<Stage>(() =>
        pickInitialStage(initialMode, initialBuildDir, initialDomain, initialPublish),
    );

    const advance = (
        nextMode: SignerMode | null = mode,
        nextBuildDir: string | null = buildDir,
        nextDomain: string | null = domain,
        nextPublish: boolean | null = publishToPlayground,
    ) => {
        const s = pickNextStage(nextMode, nextBuildDir, nextDomain, nextPublish);
        setStage(s);
    };

    // Used only once inputs are fully resolved; read by the `running` stage.
    const resolved = useMemo<Resolved | null>(() => {
        if (mode === null || buildDir === null || domain === null || publishToPlayground === null)
            return null;
        return { mode, buildDir, domain, publishToPlayground };
    }, [mode, buildDir, domain, publishToPlayground]);

    return (
        <Box flexDirection="column" paddingLeft={2}>
            {stage.kind === "prompt-signer" && (
                <SignerPrompt
                    onSelect={(m) => {
                        setMode(m);
                        advance(m);
                    }}
                />
            )}
            {stage.kind === "prompt-buildDir" && (
                <TextPrompt
                    label="Build directory"
                    initial={DEFAULT_BUILD_DIR}
                    onSubmit={(v) => {
                        setBuildDir(v);
                        advance(mode, v);
                    }}
                />
            )}
            {stage.kind === "prompt-domain" && (
                <TextPrompt
                    label="Domain (e.g. my-app)"
                    initial=""
                    prefill={domain ?? ""}
                    externalError={domainError}
                    validate={(v) =>
                        /^[a-z0-9][a-z0-9-]*(\.dot)?$/i.test(v.trim())
                            ? null
                            : "Use lowercase letters, digits, and dashes."
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
                    ownerSs58Address={userSigner?.address}
                    onAvailable={(result) => {
                        setDomain(result.fullDomain);
                        advance(mode, buildDir, result.fullDomain);
                    }}
                    onUnavailable={(reason) => {
                        setDomainError(reason);
                        setStage({ kind: "prompt-domain" });
                    }}
                />
            )}
            {stage.kind === "prompt-publish" && (
                <YesNoPrompt
                    label="Publish to the Playground?"
                    initial={false}
                    onSubmit={(yes) => {
                        setPublishToPlayground(yes);
                        advance(mode, buildDir, domain, yes);
                    }}
                />
            )}
            {stage.kind === "confirm" && resolved && (
                <ConfirmStage
                    inputs={resolved}
                    userSigner={userSigner}
                    onProceed={() => setStage({ kind: "running" })}
                    onCancel={() => {
                        onDone(null);
                    }}
                />
            )}
            {stage.kind === "running" && resolved && (
                <RunningStage
                    projectDir={projectDir}
                    inputs={resolved}
                    userSigner={userSigner}
                    onFinish={(outcome) => {
                        setStage({ kind: "done", outcome });
                        onDone(outcome);
                    }}
                    onError={(message) => {
                        setStage({ kind: "error", message });
                        onDone(null);
                    }}
                />
            )}
            {stage.kind === "done" && <FinalResult outcome={stage.outcome} />}
            {stage.kind === "error" && (
                <Box flexDirection="column" marginTop={1}>
                    <Box gap={1}>
                        <Failed />
                        <Text color="red" bold>
                            Deploy failed
                        </Text>
                    </Box>
                    <Text color="red" dimColor wrap="wrap">
                        {stage.message}
                    </Text>
                </Box>
            )}
        </Box>
    );
}

// ── Stage pickers ────────────────────────────────────────────────────────────

function pickInitialStage(
    mode: SignerMode | null,
    buildDir: string | null,
    domain: string | null,
    publish: boolean | null,
): Stage {
    return pickNextStage(mode, buildDir, domain, publish);
}

function pickNextStage(
    mode: SignerMode | null,
    buildDir: string | null,
    domain: string | null,
    publish: boolean | null,
): Stage {
    if (mode === null) return { kind: "prompt-signer" };
    if (buildDir === null) return { kind: "prompt-buildDir" };
    if (domain === null) return { kind: "prompt-domain" };
    if (publish === null) return { kind: "prompt-publish" };
    return { kind: "confirm" };
}

// ── Prompt components ────────────────────────────────────────────────────────

function SignerPrompt({ onSelect }: { onSelect: (mode: SignerMode) => void }) {
    const [index, setIndex] = useState(0);
    const options: Array<{ mode: SignerMode; label: string; hint: string }> = [
        { mode: "dev", label: "Dev signer", hint: "Fast. 0 phone taps for upload." },
        { mode: "phone", label: "Your phone signer", hint: "Signed with your logged-in account." },
    ];

    useInput((_input, key) => {
        if (key.upArrow) setIndex((i) => (i - 1 + options.length) % options.length);
        if (key.downArrow) setIndex((i) => (i + 1) % options.length);
        if (key.return) onSelect(options[index].mode);
    });

    return (
        <Box flexDirection="column">
            <Text bold>Signer — use ↑/↓ then Enter</Text>
            {options.map((opt, i) => (
                <Box key={opt.mode} gap={1}>
                    <Text color={i === index ? "cyan" : undefined}>{i === index ? "▸" : " "}</Text>
                    <Text color={i === index ? "cyan" : undefined} bold={i === index}>
                        {opt.label}
                    </Text>
                    <Text dimColor>— {opt.hint}</Text>
                </Box>
            ))}
        </Box>
    );
}

function TextPrompt({
    label,
    initial,
    prefill,
    externalError,
    validate,
    onSubmit,
}: {
    label: string;
    initial: string;
    prefill?: string;
    externalError?: string | null;
    validate?: (value: string) => string | null;
    onSubmit: (value: string) => void;
}) {
    const [value, setValue] = useState(prefill ?? initial);
    const [error, setError] = useState<string | null>(null);

    useInput((input, key) => {
        if (key.return) {
            const final = value.trim() || initial;
            if (validate) {
                const msg = validate(final);
                if (msg) {
                    setError(msg);
                    return;
                }
            }
            onSubmit(final);
            return;
        }
        if (key.backspace || key.delete) {
            setValue((v) => v.slice(0, -1));
            setError(null);
            return;
        }
        if (key.ctrl || key.meta) return;
        // Accept printable characters.
        if (input && input.length > 0 && input >= " " && input !== "\t") {
            setValue((v) => v + input);
            setError(null);
        }
    });

    const shownError = error ?? externalError ?? null;
    return (
        <Box flexDirection="column">
            <Text bold>
                {label}
                {initial ? ` [${initial}]` : ""}
            </Text>
            <Box>
                <Text color="cyan">▸ </Text>
                <Text>{value}</Text>
                <Text color="cyan">█</Text>
            </Box>
            {shownError && <Text color="red">{shownError}</Text>}
        </Box>
    );
}

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
                    // Short hold so the user can read any note (e.g. "PoP will
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
                setMessage(`Availability check failed: ${msg}`);
                setTimeout(() => {
                    if (!cancelled) onUnavailable(msg);
                }, 600);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [domain]);

    return (
        <Box flexDirection="column">
            <Box gap={1}>
                {status === "checking" ? <Spinner /> : status === "done" ? <Done /> : <Failed />}
                <Text>
                    {status === "checking" ? `Checking availability of ${domain}…` : message}
                </Text>
            </Box>
        </Box>
    );
}

function YesNoPrompt({
    label,
    initial,
    onSubmit,
}: {
    label: string;
    initial: boolean;
    onSubmit: (yes: boolean) => void;
}) {
    const [yes, setYes] = useState(initial);

    useInput((input, key) => {
        if (key.leftArrow || key.rightArrow || input === "y" || input === "n") {
            setYes((prev) => (input === "y" ? true : input === "n" ? false : !prev));
        }
        if (key.return) onSubmit(yes);
    });

    return (
        <Box flexDirection="column">
            <Text bold>{label} (y/n, ←/→ to toggle)</Text>
            <Box gap={2}>
                <Text color={yes ? "cyan" : undefined} bold={yes}>
                    {yes ? "▸ Yes" : "  Yes"}
                </Text>
                <Text color={!yes ? "cyan" : undefined} bold={!yes}>
                    {!yes ? "▸ No" : "  No"}
                </Text>
            </Box>
        </Box>
    );
}

// ── Confirm stage ────────────────────────────────────────────────────────────

function ConfirmStage({
    inputs,
    userSigner,
    onProceed,
    onCancel,
}: {
    inputs: Resolved;
    userSigner: ResolvedSigner | null;
    onProceed: () => void;
    onCancel: () => void;
}) {
    const setup = useMemo(() => {
        try {
            return resolveSignerSetup({
                mode: inputs.mode,
                userSigner,
                publishToPlayground: inputs.publishToPlayground,
            });
        } catch (err) {
            return {
                approvals: [] as DeployApproval[],
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }, [inputs, userSigner]);

    const view = buildSummaryView({
        mode: inputs.mode,
        domain: inputs.domain.replace(/\.dot$/, "") + ".dot",
        buildDir: inputs.buildDir,
        publishToPlayground: inputs.publishToPlayground,
        approvals: "approvals" in setup ? setup.approvals : [],
    });

    useInput((_input, key) => {
        if (key.return) onProceed();
        if (key.escape) onCancel();
    });

    return (
        <Box flexDirection="column">
            <Text bold>{view.headline}</Text>
            <Box flexDirection="column" marginTop={1}>
                {view.rows.map((row) => (
                    <Box key={row.label} gap={2}>
                        <Text color="cyan">{row.label.padEnd(10)}</Text>
                        <Text>{row.value}</Text>
                    </Box>
                ))}
            </Box>
            <Box flexDirection="column" marginTop={1}>
                {view.totalApprovals === 0 ? (
                    <Text dimColor>No phone approvals required.</Text>
                ) : (
                    <>
                        <Text bold>Phone approvals required: {view.totalApprovals}</Text>
                        {view.approvalLines.map((line) => (
                            <Text key={line} dimColor>
                                {"   "}
                                {line}
                            </Text>
                        ))}
                    </>
                )}
            </Box>
            <Box marginTop={1}>
                <Text>Press Enter to deploy, Esc to cancel.</Text>
            </Box>
            {"error" in setup && setup.error && (
                <Box marginTop={1} gap={1}>
                    <Warning />
                    <Text color="yellow">{setup.error}</Text>
                </Box>
            )}
        </Box>
    );
}

// ── Running stage ────────────────────────────────────────────────────────────

interface PhaseState {
    status: "pending" | "running" | "complete" | "error";
    detail?: string;
}

const PHASE_ORDER: DeployPhase[] = ["build", "storage-and-dotns", "playground", "done"];
const PHASE_TITLE: Record<DeployPhase, string> = {
    build: "Build",
    "storage-and-dotns": "Upload + DotNS",
    playground: "Publish to Playground",
    done: "Done",
};

function RunningStage({
    projectDir,
    inputs,
    userSigner,
    onFinish,
    onError,
}: {
    projectDir: string;
    inputs: Resolved;
    userSigner: ResolvedSigner | null;
    onFinish: (outcome: DeployOutcome) => void;
    onError: (message: string) => void;
}) {
    const initialPhases: Record<DeployPhase, PhaseState> = {
        build: { status: "pending" },
        "storage-and-dotns": { status: "pending" },
        playground: {
            status: inputs.publishToPlayground ? "pending" : "complete",
            detail: inputs.publishToPlayground ? undefined : "skipped",
        },
        done: { status: "pending" },
    };
    const [phases, setPhases] = useState(initialPhases);
    const [signingPrompt, setSigningPrompt] = useState<SigningEvent | null>(null);
    const [latestInfo, setLatestInfo] = useState<string | null>(null);

    // ── Throttled info updates ──────────────────────────────────────────
    // Verbose builds (vite / next) and bulletin-deploy's per-chunk logs
    // can fire hundreds of "build-log" / "info" events per second. Calling
    // setLatestInfo on every one floods React's update queue and — on long
    // deploys — builds up enough backpressure to spike memory into the
    // gigabytes. Users only ever see the most recent line anyway, so we
    // coalesce updates to ~10 per second via a ref-based sink.
    const pendingInfoRef = useRef<string | null>(null);
    const infoTimerRef = useRef<NodeJS.Timeout | null>(null);
    const INFO_THROTTLE_MS = 100;
    const INFO_MAX_LEN = 160;
    const queueInfo = (line: string) => {
        const truncated = line.length > INFO_MAX_LEN ? `${line.slice(0, INFO_MAX_LEN - 1)}…` : line;
        pendingInfoRef.current = truncated;
        if (infoTimerRef.current === null) {
            infoTimerRef.current = setTimeout(() => {
                if (pendingInfoRef.current !== null) {
                    setLatestInfo(pendingInfoRef.current);
                    pendingInfoRef.current = null;
                }
                infoTimerRef.current = null;
            }, INFO_THROTTLE_MS);
        }
    };

    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const outcome = await runDeploy({
                    projectDir,
                    buildDir: inputs.buildDir,
                    domain: inputs.domain,
                    mode: inputs.mode,
                    publishToPlayground: inputs.publishToPlayground,
                    userSigner,
                    onEvent: (event) => handleEvent(event),
                });
                if (!cancelled) onFinish(outcome);
            } catch (err) {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : String(err);
                    onError(message);
                }
            }
        })();

        function handleEvent(event: DeployEvent) {
            if (event.kind === "phase-start") {
                setPhases((p) => ({ ...p, [event.phase]: { status: "running" } }));
            } else if (event.kind === "phase-complete") {
                setPhases((p) => ({ ...p, [event.phase]: { status: "complete" } }));
            } else if (event.kind === "build-log") {
                queueInfo(event.line);
            } else if (event.kind === "build-detected") {
                queueInfo(`> ${event.config.description}`);
            } else if (event.kind === "storage-event") {
                if (event.event.kind === "chunk-progress") {
                    queueInfo(`Uploading chunk ${event.event.current}/${event.event.total}`);
                } else if (event.event.kind === "info") {
                    queueInfo(event.event.message);
                }
            } else if (event.kind === "signing") {
                if (event.event.kind === "sign-request") {
                    setSigningPrompt(event.event);
                } else if (event.event.kind === "sign-complete") {
                    setSigningPrompt(null);
                } else if (event.event.kind === "sign-error") {
                    setSigningPrompt(null);
                    queueInfo(`Signing rejected: ${event.event.message}`);
                }
            } else if (event.kind === "error") {
                setPhases((p) => ({
                    ...p,
                    [event.phase]: { status: "error", detail: event.message },
                }));
            }
        }

        return () => {
            cancelled = true;
            if (infoTimerRef.current !== null) {
                clearTimeout(infoTimerRef.current);
                infoTimerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <Box flexDirection="column">
            {PHASE_ORDER.filter((p) => p !== "done").map((phase) => {
                const state = phases[phase];
                return (
                    <Box key={phase} gap={1}>
                        {state.status === "running" && <Spinner />}
                        {state.status === "complete" && <Done />}
                        {state.status === "error" && <Failed />}
                        {state.status === "pending" && <Text dimColor>•</Text>}
                        <Text bold={state.status === "running"}>{PHASE_TITLE[phase]}</Text>
                        {state.detail && <Text dimColor>— {state.detail}</Text>}
                    </Box>
                );
            })}
            {latestInfo && (
                <Box marginTop={1} paddingLeft={2}>
                    <Text dimColor>{truncate(latestInfo, 120)}</Text>
                </Box>
            )}
            {signingPrompt && signingPrompt.kind === "sign-request" && (
                <Box
                    marginTop={1}
                    borderStyle="round"
                    borderColor="yellowBright"
                    paddingX={1}
                    flexDirection="column"
                >
                    <Text color="yellowBright" bold>
                        📱 Check your phone
                    </Text>
                    <Text>
                        Approve step {signingPrompt.step} of {signingPrompt.total}:{" "}
                        <Text bold>{signingPrompt.label}</Text>
                    </Text>
                </Box>
            )}
        </Box>
    );
}

// ── Final result ─────────────────────────────────────────────────────────────

function FinalResult({ outcome }: { outcome: DeployOutcome }) {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Box gap={1}>
                <Done />
                <Text color="green" bold>
                    Deploy complete
                </Text>
            </Box>
            <Box flexDirection="column" marginTop={1}>
                <LabelValue label="URL" value={outcome.appUrl} />
                <LabelValue label="Domain" value={outcome.fullDomain} />
                <LabelValue label="App CID" value={outcome.appCid} />
                {outcome.ipfsCid && <LabelValue label="IPFS CID" value={outcome.ipfsCid} />}
                {outcome.metadataCid && (
                    <LabelValue label="Metadata CID" value={outcome.metadataCid} />
                )}
            </Box>
        </Box>
    );
}

function LabelValue({ label, value }: { label: string; value: string }) {
    return (
        <Box gap={2}>
            <Text color="cyan">{label.padEnd(12)}</Text>
            <Text>{value}</Text>
        </Box>
    );
}

function truncate(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
