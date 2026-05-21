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

import type { BuildEvent, ContractInfo, DeployEvent } from "@dotdm/contracts";

export type ContractState =
    | "waiting"
    | "building"
    | "built"
    | "checking"
    | "cached"
    | "deploying"
    | "done"
    | "error";

export interface ContractStatus {
    crateName: string;
    state: ContractState;
    error?: string;
    address?: string;
    cid?: string;
    deployTxHash?: string;
    deployBlockHash?: string;
    publishTxHash?: string;
    durationMs?: number;
    buildProgress?: { compiled: number; total: number };
    bytecodeSize?: number;
    deployInProgress?: boolean;
    publishInProgress?: boolean;
    registerInProgress?: boolean;
}

export interface PhaseInfo {
    name:
        | "connecting-registry"
        | "checking-versions"
        | "precomputing-addresses"
        | "preparing-metadata"
        | "deploying"
        | "publishing"
        | "done";
    description: string;
    layer?: number;
}

interface AdapterOptions {
    onCdmPackageDetected?: (crateName: string, cdmPackage: string) => void;
}

export class ContractPipelineStatusAdapter {
    static readonly LOG_TAIL_LINES = 5;

    readonly statuses = new Map<string, ContractStatus>();
    readonly logLines: string[] = [];
    crates: string[] = [];
    layers: string[][] = [];
    contracts: ContractInfo[] = [];
    cdmPackageMap = new Map<string, string>();
    phase: PhaseInfo | null = null;

    constructor(private opts: AdapterOptions = {}) {}

    handleDeployEvent = (event: DeployEvent) => {
        switch (event.type) {
            case "detect":
            case "log":
            case "build-start":
            case "build-progress":
            case "build-done":
            case "build-error":
                this.handleBuildEvent(event as BuildEvent);
                return;
            case "check-cached":
                this.update(event.crate, "cached", { address: event.address });
                return;
            case "check-needs-deploy":
                this.update(event.crate, "checking", { address: event.address });
                return;
            case "phase":
                this.phase = {
                    name: event.name,
                    description: event.description,
                    layer: event.layer,
                };
                return;
            case "sign-request":
            case "deploy-plan":
                return;
            case "deploy-register-start":
                for (const crate of event.crates) {
                    this.update(crate, "deploying", {
                        deployInProgress: true,
                        registerInProgress: this.cdmPackageMap.has(crate),
                    });
                }
                return;
            case "publish-start":
                for (const crate of event.crates) {
                    this.update(crate, "deploying", { publishInProgress: true });
                }
                return;
            case "deploy-register-done":
                for (const crate of Object.keys(event.addresses)) {
                    const address = event.addresses[crate];
                    if (!address) continue;
                    this.update(crate, "done", {
                        address,
                        deployInProgress: false,
                        registerInProgress: false,
                        deployTxHash: event.txHash,
                        deployBlockHash: event.blockHash,
                        durationMs: event.durationMs,
                    });
                }
                return;
            case "publish-done":
                for (const crate of Object.keys(event.cids)) {
                    const cid = event.cids[crate];
                    const current = this.statuses.get(crate);
                    this.update(crate, current?.state ?? "done", {
                        cid,
                        publishInProgress: false,
                        publishTxHash: event.txHash,
                    });
                }
                return;
            case "deploy-register-error":
                for (const crate of event.crates) {
                    this.update(crate, "error", {
                        error: event.error,
                        deployInProgress: false,
                        publishInProgress: false,
                        registerInProgress: false,
                    });
                }
                return;
            case "pipeline-done":
                this.phase = {
                    name: "done",
                    description: "Pipeline complete",
                };
                if (event.summary.contracts.every((contract) => contract.status !== "error")) {
                    this.clearLogs();
                }
                return;
            case "pipeline-error":
                this.phase = {
                    name: "done",
                    description: "Pipeline failed",
                };
                return;
        }
    };

    private handleBuildEvent(event: BuildEvent) {
        switch (event.type) {
            case "log":
                this.appendLog(event.line);
                return;
            case "detect":
                this.contracts = event.contracts;
                this.layers = event.layers;
                this.crates = event.layers.flat();
                for (const contract of event.contracts) {
                    if (contract.cdmPackage) {
                        this.cdmPackageMap.set(contract.name, contract.cdmPackage);
                        this.opts.onCdmPackageDetected?.(contract.name, contract.cdmPackage);
                    } else if (contract.displayName && contract.displayName !== contract.name) {
                        this.opts.onCdmPackageDetected?.(contract.name, contract.displayName);
                    }
                }
                for (const crate of this.crates) {
                    if (!this.statuses.has(crate)) {
                        this.statuses.set(crate, { crateName: crate, state: "waiting" });
                    }
                }
                return;
            case "build-start":
                this.update(event.crate, "building");
                return;
            case "build-progress":
                this.update(event.crate, "building", {
                    buildProgress: {
                        compiled: event.compiled,
                        total: event.total,
                    },
                });
                return;
            case "build-done":
                this.update(event.crate, "built", {
                    durationMs: event.durationMs,
                    bytecodeSize: event.bytecodeSize,
                    buildProgress: { compiled: 1, total: 1 },
                });
                return;
            case "build-error":
                this.update(event.crate, "error", { error: event.error });
                return;
            case "pipeline-done":
                return;
            case "pipeline-error":
                this.phase = {
                    name: "done",
                    description: "Pipeline failed",
                };
                return;
        }
    }

    private update(crateName: string, state: ContractState, extra?: Partial<ContractStatus>) {
        const current = this.statuses.get(crateName) ?? { crateName, state: "waiting" };
        this.statuses.set(crateName, { ...current, state, ...extra });
    }

    private appendLog(rawLine: string) {
        const line = cleanLogLine(rawLine);
        if (!line) return;
        this.logLines.push(line);
        if (this.logLines.length > ContractPipelineStatusAdapter.LOG_TAIL_LINES) {
            this.logLines.splice(
                0,
                this.logLines.length - ContractPipelineStatusAdapter.LOG_TAIL_LINES,
            );
        }
    }

    private clearLogs() {
        this.logLines.splice(0);
    }
}

const ANSI_PATTERN =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal log sanitization.
    /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

function cleanLogLine(line: string): string {
    return line.replace(ANSI_PATTERN, "").replace(/\r/g, "").trimEnd();
}
