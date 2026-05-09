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
 * Pure reducer + initial-state builder for the running-deploy TUI. Must stay
 * free of React/Ink so it can be unit-tested. Log-line updates are throttled
 * inside the component and deliberately not handled here.
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
                // Mark rows running up-front: cdm can take 10–20s between
                // compile-detected and the first deploy-chunk, during which
                // idle rows make the UI look frozen.
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
        default:
            return state;
    }
}
