/**
 * Pure reducer + initial-state builder for the running-deploy TUI.
 *
 * Lifted out of `DeployScreen.tsx`'s `RunningStage` so the state-transition
 * logic can be unit-tested without dragging React + Ink into the vitest
 * runner. Keep this file free of React, Ink, and any side effects — the
 * reducer must be a pure function of `(state, event) -> state`.
 *
 * Log-line updates (anything that would call `queueContractsLog` /
 * `queueFrontendLog`) intentionally live in the component: they are
 * throttled via refs + timers and are orthogonal to state transitions.
 * The reducer only touches phase status, contract rows, and error messages.
 */

import type { DeployEvent } from "../../utils/deploy/index.js";

export type StepStatus = "pending" | "running" | "complete" | "error" | "skipped";

export interface ContractRowState {
    name: string;
    status: StepStatus;
    address?: string;
}

export interface ContractsSectionState {
    buildStatus: StepStatus;
    deployStatus: StepStatus;
    contracts: ContractRowState[];
    error?: string;
    latestLog: string | null;
}

export interface FrontendSectionState {
    buildStatus: StepStatus;
    uploadStatus: StepStatus;
    error?: string;
    latestLog: string | null;
}

export interface PlaygroundRowState {
    status: StepStatus;
    error?: string;
}

export interface RunningState {
    contracts: ContractsSectionState;
    frontend: FrontendSectionState;
    playground: PlaygroundRowState;
}

export interface RunningStateInputs {
    deployContracts: boolean;
    skipBuild: boolean;
    publishToPlayground: boolean;
}

export function initialRunningState(inputs: RunningStateInputs): RunningState {
    return {
        contracts: {
            buildStatus: inputs.deployContracts ? "pending" : "skipped",
            deployStatus: inputs.deployContracts ? "pending" : "skipped",
            contracts: [],
            latestLog: null,
        },
        frontend: {
            buildStatus: inputs.skipBuild ? "skipped" : "pending",
            uploadStatus: "pending",
            latestLog: null,
        },
        playground: {
            status: inputs.publishToPlayground ? "pending" : "skipped",
        },
    };
}

/**
 * Pure state transition for the running-deploy UI.
 *
 * Must mirror the `handleEvent` switch inside `RunningStage` in
 * `DeployScreen.tsx` for the status / error slots. Events that only
 * affect log lines (`build-log`, `storage-event`, `signing`, raw
 * `contracts-event` info/compile-log, plus `plan`) are passed through
 * unchanged — the component handles those via its throttled log sinks.
 */
export function runningReducer(state: RunningState, event: DeployEvent): RunningState {
    switch (event.kind) {
        case "phase-start": {
            if (event.phase === "build") {
                return {
                    ...state,
                    frontend: { ...state.frontend, buildStatus: "running" },
                };
            }
            if (event.phase === "contracts") {
                return {
                    ...state,
                    contracts: { ...state.contracts, buildStatus: "running" },
                };
            }
            if (event.phase === "storage-and-dotns") {
                return {
                    ...state,
                    frontend: { ...state.frontend, uploadStatus: "running" },
                };
            }
            if (event.phase === "playground") {
                return { ...state, playground: { status: "running" } };
            }
            return state;
        }
        case "phase-complete": {
            if (event.phase === "build") {
                return {
                    ...state,
                    frontend: { ...state.frontend, buildStatus: "complete" },
                };
            }
            if (event.phase === "contracts") {
                return {
                    ...state,
                    contracts: {
                        ...state.contracts,
                        buildStatus:
                            state.contracts.buildStatus === "skipped" ? "skipped" : "complete",
                        deployStatus: "complete",
                    },
                };
            }
            if (event.phase === "storage-and-dotns") {
                return {
                    ...state,
                    frontend: { ...state.frontend, uploadStatus: "complete" },
                };
            }
            if (event.phase === "playground") {
                return { ...state, playground: { status: "complete" } };
            }
            return state;
        }
        case "phase-skipped": {
            if (event.phase === "contracts") {
                return {
                    ...state,
                    contracts: {
                        ...state.contracts,
                        buildStatus: "skipped",
                        deployStatus: "skipped",
                    },
                };
            }
            if (event.phase === "build") {
                return {
                    ...state,
                    frontend: { ...state.frontend, buildStatus: "skipped" },
                };
            }
            if (event.phase === "storage-and-dotns") {
                return {
                    ...state,
                    frontend: { ...state.frontend, uploadStatus: "skipped" },
                };
            }
            if (event.phase === "playground") {
                return { ...state, playground: { status: "skipped" } };
            }
            return state;
        }
        case "contracts-event": {
            const e = event.event;
            if (e.kind === "compile-detected") {
                // Build just finished producing artifacts; deploy starts
                // next. Mark every contract as "running" up-front — cdm's
                // planDeploy + chunk submission can take 10–20s before
                // the first deploy-chunk event fires, and without a live
                // spinner on each sub-row it looks like the UI froze.
                return {
                    ...state,
                    contracts: {
                        ...state.contracts,
                        buildStatus: "complete",
                        deployStatus: "running",
                        contracts: e.contracts.map((name) => ({ name, status: "running" })),
                    },
                };
            }
            if (e.kind === "deploy-chunk") {
                // Each chunk landed — mark its contracts complete with
                // their on-chain addresses as soon as we know them,
                // rather than waiting for deploy-done.
                const byName = new Map(e.contracts.map((c) => [c.name, c.address]));
                return {
                    ...state,
                    contracts: {
                        ...state.contracts,
                        contracts: state.contracts.contracts.map((c) =>
                            byName.has(c.name)
                                ? { ...c, status: "complete", address: byName.get(c.name) }
                                : c,
                        ),
                    },
                };
            }
            if (e.kind === "deploy-done") {
                const byName = new Map(e.addresses.map((a) => [a.name, a.address]));
                return {
                    ...state,
                    contracts: {
                        ...state.contracts,
                        deployStatus: "complete",
                        contracts: state.contracts.contracts.map((c) => ({
                            ...c,
                            status: "complete",
                            address: byName.get(c.name) ?? c.address,
                        })),
                    },
                };
            }
            // `info` and `compile-log` are log-only; ignored by the reducer.
            return state;
        }
        case "error": {
            const msg = event.message;
            if (event.phase === "build") {
                return {
                    ...state,
                    frontend: { ...state.frontend, buildStatus: "error", error: msg },
                };
            }
            if (event.phase === "contracts") {
                return {
                    ...state,
                    contracts: { ...state.contracts, deployStatus: "error", error: msg },
                };
            }
            if (event.phase === "storage-and-dotns") {
                return {
                    ...state,
                    frontend: { ...state.frontend, uploadStatus: "error", error: msg },
                };
            }
            if (event.phase === "playground") {
                return { ...state, playground: { status: "error", error: msg } };
            }
            return state;
        }
        // Log/signing/plan events are orthogonal to status state — handled
        // by the component's throttled log sinks, not the reducer.
        default:
            return state;
    }
}
