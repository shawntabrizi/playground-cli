import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import {
    Header,
    Row,
    Section,
    Hint,
    Callout,
    Sparkline,
    Select,
    Input,
    Mark,
    LAYOUT,
    setWindowTitle,
    type MarkKind,
} from "../../utils/ui/theme/index.js";
import {
    runDeploy,
    resolveSignerSetup,
    checkDomainAvailability,
    formatAvailability,
    readReadme,
    README_CAP_BYTES,
    type AvailabilityResult,
    type DeployEvent,
    type DeployOutcome,
    type DeployPlan,
    type SignerMode,
    type DeployApproval,
    type SigningEvent,
} from "../../utils/deploy/index.js";
import { buildSummaryView } from "./summary.js";
import { readSessionAccount, SESSION_MIN_BALANCE } from "../../utils/deploy/session-account.js";
import { checkBalance } from "../../utils/account/funding.js";
import { getConnection } from "../../utils/connection.js";
import type { ResolvedSigner } from "../../utils/signer.js";
import type { ContractsType } from "../../utils/build/detect.js";
import { DEFAULT_BUILD_DIR } from "../../config.js";
import { VERSION_LABEL } from "../../utils/version.js";

export interface DeployScreenInputs {
    projectDir: string;
    domain: string | null;
    buildDir: string | null;
    mode: SignerMode | null;
    publishToPlayground: boolean | null;
    skipBuild: boolean | null;
    /** Contract-project kind at `projectDir`, or null if none detected. */
    contractsType: ContractsType | null;
    /** Whether to deploy the project's contracts. null = ask the user. */
    deployContracts: boolean | null;
    userSigner: ResolvedSigner | null;
    onDone: (outcome: DeployOutcome | null) => void;
}

type Stage =
    | { kind: "prompt-build" }
    | { kind: "prompt-signer" }
    | { kind: "prompt-buildDir" }
    | { kind: "prompt-domain" }
    | { kind: "validate-domain"; domain: string }
    | { kind: "prompt-publish" }
    | { kind: "prompt-contracts" }
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
    deployContracts: boolean;
}

export function DeployScreen({
    projectDir,
    domain: initialDomain,
    buildDir: initialBuildDir,
    mode: initialMode,
    publishToPlayground: initialPublish,
    skipBuild: initialSkipBuild,
    contractsType,
    deployContracts: initialDeployContracts,
    userSigner,
    onDone,
}: DeployScreenInputs) {
    const [mode, setMode] = useState<SignerMode | null>(initialMode);
    const [buildDir, setBuildDir] = useState<string | null>(initialBuildDir);
    const [domain, setDomain] = useState<string | null>(initialDomain);
    const [publishToPlayground, setPublishToPlayground] = useState<boolean | null>(initialPublish);
    const [skipBuild, setSkipBuild] = useState<boolean | null>(initialSkipBuild);
    // When the project has no contracts at all we short-circuit the prompt to
    // `false` so the confirm stage doesn't wait on a decision that can't be
    // made. When contracts *are* detected, null means "ask"; anything else is
    // the resolved choice (from CLI flag or a prior prompt).
    const [deployContracts, setDeployContracts] = useState<boolean | null>(
        contractsType === null ? false : initialDeployContracts,
    );
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
            contractsType === null ? false : initialDeployContracts,
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
        nextDeployContracts: boolean | null = deployContracts,
    ) => {
        const s = pickNextStage(
            nextSkipBuild,
            nextMode,
            nextBuildDir,
            nextDomain,
            nextPublish,
            nextDeployContracts,
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
            deployContracts === null
        )
            return null;
        return { mode, buildDir, domain, publishToPlayground, skipBuild, deployContracts };
    }, [mode, buildDir, domain, publishToPlayground, skipBuild, deployContracts]);

    // Dynamic terminal tab title: subtitle becomes the domain once we know it.
    const headerSubtitle = resolved?.domain ?? domain ?? undefined;

    return (
        <Box flexDirection="column">
            <Header
                cmd="dot deploy"
                subtitle={headerSubtitle}
                network="paseo"
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
                    // Only gate on the user's address in phone mode — see
                    // `ownerSs58Address` docs in availability.ts. In dev mode
                    // bulletin-deploy signs DotNS with its own DEFAULT_MNEMONIC,
                    // so the user's H160 does not match the registrar's H160
                    // and the preflight would mis-report re-deploys as "taken".
                    ownerSs58Address={mode === "phone" ? userSigner?.address : undefined}
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
                        advance(skipBuild, mode, buildDir, domain, yes);
                    }}
                />
            )}

            {stage.kind === "prompt-contracts" && contractsType !== null && (
                <Select<boolean>
                    label={`deploy ${contractsType} contracts?`}
                    options={[
                        { value: false, label: "no", hint: "skip the contracts phase" },
                        {
                            value: true,
                            label: "yes",
                            hint: `compile & deploy via ${contractsType}`,
                        },
                    ]}
                    initialIndex={0}
                    onSelect={(yes) => {
                        setDeployContracts(yes);
                        advance(skipBuild, mode, buildDir, domain, publishToPlayground, yes);
                    }}
                />
            )}

            {stage.kind === "confirm" && resolved && (
                <ConfirmStage
                    projectDir={projectDir}
                    inputs={resolved}
                    contractsType={contractsType}
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
    deployContracts: boolean | null,
): Stage {
    return pickNextStage(skipBuild, mode, buildDir, domain, publish, deployContracts);
}

function pickNextStage(
    skipBuild: boolean | null,
    mode: SignerMode | null,
    buildDir: string | null,
    domain: string | null,
    publish: boolean | null,
    deployContracts: boolean | null,
): Stage {
    if (skipBuild === null) return { kind: "prompt-build" };
    if (mode === null) return { kind: "prompt-signer" };
    if (buildDir === null) return { kind: "prompt-buildDir" };
    if (domain === null) return { kind: "prompt-domain" };
    if (publish === null) return { kind: "prompt-publish" };
    if (deployContracts === null) return { kind: "prompt-contracts" };
    return { kind: "confirm" };
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
    contractsType,
    userSigner,
    plan,
    onProceed,
    onCancel,
}: {
    projectDir: string;
    inputs: Resolved;
    contractsType: ContractsType | null;
    userSigner: ResolvedSigner | null;
    plan: DeployPlan | null;
    onProceed: () => void;
    onCancel: () => void;
}) {
    // Whether the contracts phase will need to sign a Balances.transfer to
    // top up the session key. Starts pessimistic (yes, needed) so the
    // approvals list is populated immediately; resolved asynchronously
    // by a one-shot balance query below. Only affects phone sessions —
    // local dev funders run in-process without a user tap.
    const needsSessionFunding = inputs.deployContracts && userSigner?.source === "session";
    const [contractsFundingNeeded, setContractsFundingNeeded] =
        useState<boolean>(needsSessionFunding);

    useEffect(() => {
        if (!needsSessionFunding) return;
        let cancelled = false;
        (async () => {
            try {
                const session = await readSessionAccount();
                if (session === null) {
                    // No key minted yet → the deploy path will create one
                    // and fund it, so a tap is guaranteed. Leave
                    // `contractsFundingNeeded` at its pessimistic default.
                    return;
                }
                const client = await getConnection();
                const { sufficient } = await checkBalance(
                    client,
                    session.account.ss58Address,
                    SESSION_MIN_BALANCE,
                );
                if (!cancelled) setContractsFundingNeeded(!sufficient);
            } catch {
                // If the pre-check fails (network blip, etc.), leave the
                // default `true` in place — overestimating one tap is a
                // better failure mode than hiding it and surprising the user.
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [needsSessionFunding]);

    const setup = useMemo(() => {
        try {
            return resolveSignerSetup({
                mode: inputs.mode,
                userSigner,
                publishToPlayground: inputs.publishToPlayground,
                plan: plan ?? undefined,
                contractsFundingNeeded,
            });
        } catch (err) {
            return {
                approvals: [] as DeployApproval[],
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }, [inputs, userSigner, plan, contractsFundingNeeded]);

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
        approvals: "approvals" in setup ? setup.approvals : [],
        contracts: contractsType
            ? { type: contractsType, deploy: inputs.deployContracts }
            : undefined,
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

type StepStatus = "pending" | "running" | "complete" | "error" | "skipped";

interface ContractRowState {
    name: string;
    status: StepStatus;
    address?: string;
}

interface ContractsSectionState {
    buildStatus: StepStatus;
    deployStatus: StepStatus;
    contracts: ContractRowState[];
    error?: string;
    latestLog: string | null;
}

interface FrontendSectionState {
    buildStatus: StepStatus;
    uploadStatus: StepStatus;
    error?: string;
    latestLog: string | null;
}

interface PlaygroundRowState {
    status: StepStatus;
    error?: string;
}

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
    userSigner,
    plan,
    onFinish,
    onError,
}: {
    projectDir: string;
    inputs: Resolved;
    userSigner: ResolvedSigner | null;
    plan: DeployPlan | null;
    onFinish: (outcome: DeployOutcome, chunkTimings: number[]) => void;
    onError: (message: string) => void;
}) {
    const [contractsState, setContractsState] = useState<ContractsSectionState>({
        buildStatus: inputs.deployContracts ? "pending" : "skipped",
        deployStatus: inputs.deployContracts ? "pending" : "skipped",
        contracts: [],
        latestLog: null,
    });
    const [frontendState, setFrontendState] = useState<FrontendSectionState>({
        buildStatus: inputs.skipBuild ? "skipped" : "pending",
        uploadStatus: "pending",
        latestLog: null,
    });
    const [playgroundState, setPlaygroundState] = useState<PlaygroundRowState>({
        status: inputs.publishToPlayground ? "pending" : "skipped",
    });
    const [signingPrompt, setSigningPrompt] = useState<SigningEvent | null>(null);

    // Per-chunk timing for the sparkline on completion. Held in refs to avoid
    // re-renders on every chunk tick.
    const chunkTimingsRef = useRef<number[]>([]);
    const lastChunkAtRef = useRef<number | null>(null);

    // Two independent coalescers — contracts logs and frontend logs run
    // concurrently and each update its own section's latest-line row. Per
    // the 20 GB incident in CLAUDE.md: firehose streams can't drive raw
    // setState-per-line without overwhelming Ink's reconciler. Flush each
    // sink at ≤10 Hz, keep only the most recent line, cap length at 160.
    const INFO_THROTTLE_MS = 100;
    const INFO_MAX_LEN = 160;
    const contractsPendingRef = useRef<string | null>(null);
    const contractsTimerRef = useRef<NodeJS.Timeout | null>(null);
    const frontendPendingRef = useRef<string | null>(null);
    const frontendTimerRef = useRef<NodeJS.Timeout | null>(null);
    const queueContractsLog = (line: string) => {
        const truncated = line.length > INFO_MAX_LEN ? `${line.slice(0, INFO_MAX_LEN - 1)}…` : line;
        contractsPendingRef.current = truncated;
        if (contractsTimerRef.current === null) {
            contractsTimerRef.current = setTimeout(() => {
                if (contractsPendingRef.current !== null) {
                    const v = contractsPendingRef.current;
                    contractsPendingRef.current = null;
                    setContractsState((s) => ({ ...s, latestLog: v }));
                }
                contractsTimerRef.current = null;
            }, INFO_THROTTLE_MS);
        }
    };
    const queueFrontendLog = (line: string) => {
        const truncated = line.length > INFO_MAX_LEN ? `${line.slice(0, INFO_MAX_LEN - 1)}…` : line;
        frontendPendingRef.current = truncated;
        if (frontendTimerRef.current === null) {
            frontendTimerRef.current = setTimeout(() => {
                if (frontendPendingRef.current !== null) {
                    const v = frontendPendingRef.current;
                    frontendPendingRef.current = null;
                    setFrontendState((s) => ({ ...s, latestLog: v }));
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
                const outcome = await runDeploy({
                    projectDir,
                    buildDir: inputs.buildDir,
                    skipBuild: inputs.skipBuild,
                    domain: inputs.domain,
                    mode: inputs.mode,
                    publishToPlayground: inputs.publishToPlayground,
                    deployContracts: inputs.deployContracts,
                    // Pessimistic default — if the confirm-stage balance
                    // check refined this to `false`, the counter still
                    // auto-clamps at runtime so the only downside is
                    // showing "step N of N+1" briefly if funding is
                    // actually skipped. Cheaper than threading a second
                    // piece of state through the stage transition.
                    contractsFundingNeeded:
                        inputs.deployContracts && userSigner?.source === "session",
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
            if (event.kind === "phase-start") {
                if (event.phase === "build") {
                    setFrontendState((s) => ({ ...s, buildStatus: "running" }));
                    setWindowTitle(`dot deploy · ${inputs.domain} · building`);
                } else if (event.phase === "contracts") {
                    setContractsState((s) => ({ ...s, buildStatus: "running" }));
                    setWindowTitle(`dot deploy · ${inputs.domain} · contracts`);
                } else if (event.phase === "storage-and-dotns") {
                    setFrontendState((s) => ({ ...s, uploadStatus: "running" }));
                    setWindowTitle(`dot deploy · ${inputs.domain} · uploading`);
                } else if (event.phase === "playground") {
                    setPlaygroundState({ status: "running" });
                    setWindowTitle(`dot deploy · ${inputs.domain} · publishing`);
                }
            } else if (event.kind === "phase-complete") {
                if (event.phase === "build") {
                    setFrontendState((s) => ({ ...s, buildStatus: "complete" }));
                } else if (event.phase === "contracts") {
                    setContractsState((s) => ({
                        ...s,
                        buildStatus: s.buildStatus === "skipped" ? "skipped" : "complete",
                        deployStatus: "complete",
                    }));
                } else if (event.phase === "storage-and-dotns") {
                    setFrontendState((s) => ({ ...s, uploadStatus: "complete" }));
                } else if (event.phase === "playground") {
                    setPlaygroundState({ status: "complete" });
                }
            } else if (event.kind === "phase-skipped") {
                if (event.phase === "contracts") {
                    setContractsState((s) => ({
                        ...s,
                        buildStatus: "skipped",
                        deployStatus: "skipped",
                    }));
                } else if (event.phase === "build") {
                    setFrontendState((s) => ({ ...s, buildStatus: "skipped" }));
                } else if (event.phase === "storage-and-dotns") {
                    setFrontendState((s) => ({ ...s, uploadStatus: "skipped" }));
                } else if (event.phase === "playground") {
                    setPlaygroundState({ status: "skipped" });
                }
            } else if (event.kind === "build-log") {
                queueFrontendLog(event.line);
            } else if (event.kind === "build-detected") {
                queueFrontendLog(`> ${event.config.description}`);
            } else if (event.kind === "contracts-event") {
                const e = event.event;
                if (e.kind === "info") queueContractsLog(e.message);
                else if (e.kind === "compile-log") queueContractsLog(e.line);
                else if (e.kind === "compile-detected") {
                    // Build just finished producing artifacts; deploy starts
                    // next. Mark every contract as "running" up-front — cdm's
                    // planDeploy + chunk submission can take 10–20s before
                    // the first deploy-chunk event fires, and without a live
                    // spinner on each sub-row it looks like the UI froze.
                    setContractsState((s) => ({
                        ...s,
                        buildStatus: "complete",
                        deployStatus: "running",
                        contracts: e.contracts.map((name) => ({ name, status: "running" })),
                    }));
                } else if (e.kind === "deploy-chunk") {
                    // Each chunk landed — mark its contracts complete with
                    // their on-chain addresses as soon as we know them,
                    // rather than waiting for deploy-done.
                    const byName = new Map(e.contracts.map((c) => [c.name, c.address]));
                    setContractsState((s) => ({
                        ...s,
                        contracts: s.contracts.map((c) =>
                            byName.has(c.name)
                                ? { ...c, status: "complete", address: byName.get(c.name) }
                                : c,
                        ),
                    }));
                    queueContractsLog(`deploying chunk ${e.chunk}/${e.total}`);
                } else if (e.kind === "deploy-done") {
                    const byName = new Map(e.addresses.map((a) => [a.name, a.address]));
                    setContractsState((s) => ({
                        ...s,
                        deployStatus: "complete",
                        contracts: s.contracts.map((c) => ({
                            ...c,
                            status: "complete",
                            address: byName.get(c.name) ?? c.address,
                        })),
                    }));
                }
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
                    queueFrontendLog(`signing rejected: ${event.event.message}`);
                }
            } else if (event.kind === "error") {
                const msg = event.message;
                if (event.phase === "build") {
                    setFrontendState((s) => ({
                        ...s,
                        buildStatus: "error",
                        error: msg,
                    }));
                } else if (event.phase === "contracts") {
                    setContractsState((s) => ({
                        ...s,
                        deployStatus: "error",
                        error: msg,
                    }));
                } else if (event.phase === "storage-and-dotns") {
                    setFrontendState((s) => ({
                        ...s,
                        uploadStatus: "error",
                        error: msg,
                    }));
                } else if (event.phase === "playground") {
                    setPlaygroundState({ status: "error", error: msg });
                }
            }
        }

        return () => {
            cancelled = true;
            if (contractsTimerRef.current !== null) {
                clearTimeout(contractsTimerRef.current);
                contractsTimerRef.current = null;
            }
            if (frontendTimerRef.current !== null) {
                clearTimeout(frontendTimerRef.current);
                frontendTimerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const contractsVisible = contractsState.buildStatus !== "skipped";
    return (
        <Box flexDirection="column">
            {contractsVisible && <ContractsSectionView state={contractsState} />}
            <FrontendSectionView state={frontendState} />
            {playgroundState.status !== "skipped" && (
                <Box marginTop={1}>
                    <Row
                        mark={stepMark(playgroundState.status)}
                        label="publish to playground"
                        value={playgroundState.error}
                        tone={playgroundState.status === "error" ? "danger" : "muted"}
                    />
                </Box>
            )}

            {signingPrompt && signingPrompt.kind === "sign-request" && (
                <Callout tone="warning" title="check your phone">
                    <Text>
                        approve step {signingPrompt.step} of {signingPrompt.total}:{" "}
                        <Text bold>{signingPrompt.label}</Text>
                    </Text>
                </Callout>
            )}
        </Box>
    );
}

function ContractsSectionView({ state }: { state: ContractsSectionState }) {
    const running =
        state.buildStatus === "running" ||
        state.deployStatus === "running" ||
        state.contracts.some((c) => c.status === "running");
    return (
        <Section title="contracts">
            <Row
                mark={stepMark(state.buildStatus)}
                label="build"
                tone={state.buildStatus === "error" ? "danger" : "muted"}
            />
            <Row
                mark={stepMark(state.deployStatus)}
                label="deploy"
                value={state.error}
                tone={state.deployStatus === "error" ? "danger" : "muted"}
            />
            {state.contracts.length > 0 && (
                <Box flexDirection="column" paddingLeft={LAYOUT.leftMargin + 4}>
                    {state.contracts.map((c) => (
                        <Box key={c.name} flexDirection="row">
                            <Box marginRight={1}>
                                <Mark kind={stepMark(c.status)} />
                            </Box>
                            <Box width={16}>
                                <Text>{c.name}</Text>
                            </Box>
                            {c.address && (
                                <Box flexGrow={1} paddingRight={2}>
                                    <Text dimColor wrap="truncate-middle">
                                        {c.address}
                                    </Text>
                                </Box>
                            )}
                        </Box>
                    ))}
                </Box>
            )}
            {running && state.latestLog && <Hint indent={2}>{truncate(state.latestLog, 120)}</Hint>}
        </Section>
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
                value={state.error}
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
