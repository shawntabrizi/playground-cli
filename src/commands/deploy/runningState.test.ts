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

import { describe, it, expect } from "vitest";
import { initialRunningState, runningReducer, type RunningState } from "./runningState.js";
import type { DeployEvent } from "../../utils/deploy/index.js";

const FULL_INPUTS = {
    deployContracts: true,
    skipBuild: false,
    publishToPlayground: true,
};

function baseState(
    overrides: Partial<{
        deployContracts: boolean;
        skipBuild: boolean;
        publishToPlayground: boolean;
    }> = {},
): RunningState {
    return initialRunningState({ ...FULL_INPUTS, ...overrides });
}

describe("initialRunningState", () => {
    it("deployContracts: false → contracts buildStatus & deployStatus skipped, rows empty", () => {
        const s = baseState({ deployContracts: false });
        expect(s.contracts.buildStatus).toBe("skipped");
        expect(s.contracts.deployStatus).toBe("skipped");
        expect(s.contracts.contracts).toEqual([]);
        expect(s.contracts.latestLog).toBeNull();
    });

    it("skipBuild: true → frontend.buildStatus is skipped, upload stays pending", () => {
        const s = baseState({ skipBuild: true });
        expect(s.frontend.buildStatus).toBe("skipped");
        expect(s.frontend.uploadStatus).toBe("pending");
    });

    it("publishToPlayground: false → playground status skipped", () => {
        const s = baseState({ publishToPlayground: false });
        expect(s.playground.status).toBe("skipped");
    });

    it("fully-enabled inputs → every slot starts pending", () => {
        const s = baseState();
        expect(s.contracts.buildStatus).toBe("pending");
        expect(s.contracts.deployStatus).toBe("pending");
        expect(s.frontend.buildStatus).toBe("pending");
        expect(s.frontend.uploadStatus).toBe("pending");
        expect(s.playground.status).toBe("pending");
    });
});

describe("runningReducer — phase-start", () => {
    it("build → frontend.buildStatus running", () => {
        const s = runningReducer(baseState(), { kind: "phase-start", phase: "build" });
        expect(s.frontend.buildStatus).toBe("running");
    });

    it("contracts → contracts.buildStatus running", () => {
        const s = runningReducer(baseState(), { kind: "phase-start", phase: "contracts" });
        expect(s.contracts.buildStatus).toBe("running");
    });

    it("storage-and-dotns → frontend.uploadStatus running", () => {
        const s = runningReducer(baseState(), {
            kind: "phase-start",
            phase: "storage-and-dotns",
        });
        expect(s.frontend.uploadStatus).toBe("running");
    });

    it("playground → playground.status running", () => {
        const s = runningReducer(baseState(), { kind: "phase-start", phase: "playground" });
        expect(s.playground.status).toBe("running");
    });
});

describe("runningReducer — phase-complete", () => {
    it("build → frontend.buildStatus complete", () => {
        const s = runningReducer(baseState(), { kind: "phase-complete", phase: "build" });
        expect(s.frontend.buildStatus).toBe("complete");
    });

    it("contracts → both sub-statuses complete", () => {
        const s = runningReducer(baseState(), { kind: "phase-complete", phase: "contracts" });
        expect(s.contracts.buildStatus).toBe("complete");
        expect(s.contracts.deployStatus).toBe("complete");
    });

    it("contracts → buildStatus stays skipped when it was skipped", () => {
        const s = runningReducer(baseState({ deployContracts: false }), {
            kind: "phase-complete",
            phase: "contracts",
        });
        expect(s.contracts.buildStatus).toBe("skipped");
        expect(s.contracts.deployStatus).toBe("complete");
    });

    it("storage-and-dotns → uploadStatus complete", () => {
        const s = runningReducer(baseState(), {
            kind: "phase-complete",
            phase: "storage-and-dotns",
        });
        expect(s.frontend.uploadStatus).toBe("complete");
    });

    it("playground → playground.status complete", () => {
        const s = runningReducer(baseState(), { kind: "phase-complete", phase: "playground" });
        expect(s.playground.status).toBe("complete");
    });
});

describe("runningReducer — phase-skipped", () => {
    it("contracts → both sub-statuses skipped", () => {
        const s = runningReducer(baseState(), {
            kind: "phase-skipped",
            phase: "contracts",
            reason: "no contracts",
        });
        expect(s.contracts.buildStatus).toBe("skipped");
        expect(s.contracts.deployStatus).toBe("skipped");
    });

    it("build → frontend.buildStatus skipped", () => {
        const s = runningReducer(baseState(), {
            kind: "phase-skipped",
            phase: "build",
            reason: "user skipped",
        });
        expect(s.frontend.buildStatus).toBe("skipped");
    });

    it("storage-and-dotns → uploadStatus skipped", () => {
        const s = runningReducer(baseState(), {
            kind: "phase-skipped",
            phase: "storage-and-dotns",
            reason: "no build output",
        });
        expect(s.frontend.uploadStatus).toBe("skipped");
    });

    it("playground → playground.status skipped", () => {
        const s = runningReducer(baseState(), {
            kind: "phase-skipped",
            phase: "playground",
            reason: "user opted out",
        });
        expect(s.playground.status).toBe("skipped");
    });
});

describe("runningReducer — contracts-event", () => {
    it("compile-detected → buildStatus complete, deployStatus running, contracts populated as running", () => {
        const s = runningReducer(baseState(), {
            kind: "contracts-event",
            event: { kind: "compile-detected", contracts: ["Flipper", "Counter"] },
        });
        expect(s.contracts.buildStatus).toBe("complete");
        expect(s.contracts.deployStatus).toBe("running");
        expect(s.contracts.contracts).toEqual([
            { name: "Flipper", status: "running" },
            { name: "Counter", status: "running" },
        ]);
    });

    it("deploy-chunk → named contracts complete w/ addresses, others untouched", () => {
        const s0 = runningReducer(baseState(), {
            kind: "contracts-event",
            event: { kind: "compile-detected", contracts: ["Flipper", "Counter", "Storage"] },
        });
        const s = runningReducer(s0, {
            kind: "contracts-event",
            event: {
                kind: "deploy-chunk",
                chunk: 1,
                total: 2,
                contracts: [
                    { name: "Flipper", address: "0xaaa" as `0x${string}` },
                    { name: "Counter", address: "0xbbb" as `0x${string}` },
                ],
            },
        });
        const byName = Object.fromEntries(s.contracts.contracts.map((c) => [c.name, c]));
        expect(byName.Flipper).toEqual({
            name: "Flipper",
            status: "complete",
            address: "0xaaa",
        });
        expect(byName.Counter).toEqual({
            name: "Counter",
            status: "complete",
            address: "0xbbb",
        });
        // Storage was not in the chunk — stays running, no address.
        expect(byName.Storage).toEqual({ name: "Storage", status: "running" });
        // Overall deploy still running until deploy-done fires.
        expect(s.contracts.deployStatus).toBe("running");
    });

    it("deploy-done → all contracts complete with addresses, deployStatus complete", () => {
        const s0 = runningReducer(baseState(), {
            kind: "contracts-event",
            event: { kind: "compile-detected", contracts: ["Flipper", "Counter"] },
        });
        const s = runningReducer(s0, {
            kind: "contracts-event",
            event: {
                kind: "deploy-done",
                addresses: [
                    { name: "Flipper", address: "0xaaa" as `0x${string}` },
                    { name: "Counter", address: "0xbbb" as `0x${string}` },
                ],
            },
        });
        expect(s.contracts.deployStatus).toBe("complete");
        expect(s.contracts.contracts).toEqual([
            { name: "Flipper", status: "complete", address: "0xaaa" },
            { name: "Counter", status: "complete", address: "0xbbb" },
        ]);
    });

    it("deploy-done preserves addresses from earlier deploy-chunk when deploy-done omits a name", () => {
        let s = runningReducer(baseState(), {
            kind: "contracts-event",
            event: { kind: "compile-detected", contracts: ["Flipper", "Counter"] },
        });
        s = runningReducer(s, {
            kind: "contracts-event",
            event: {
                kind: "deploy-chunk",
                chunk: 1,
                total: 1,
                contracts: [{ name: "Flipper", address: "0xaaa" as `0x${string}` }],
            },
        });
        // deploy-done with only one name — the other should fall back to the
        // address the chunk event already stamped on the row.
        s = runningReducer(s, {
            kind: "contracts-event",
            event: {
                kind: "deploy-done",
                addresses: [{ name: "Counter", address: "0xbbb" as `0x${string}` }],
            },
        });
        const byName = Object.fromEntries(s.contracts.contracts.map((c) => [c.name, c]));
        expect(byName.Flipper.address).toBe("0xaaa");
        expect(byName.Counter.address).toBe("0xbbb");
        expect(byName.Flipper.status).toBe("complete");
        expect(byName.Counter.status).toBe("complete");
    });
});

describe("runningReducer — error", () => {
    it("phase: build → frontend.buildStatus error + error set", () => {
        const s = runningReducer(baseState(), {
            kind: "error",
            phase: "build",
            message: "vite exploded",
        });
        expect(s.frontend.buildStatus).toBe("error");
        expect(s.frontend.error).toBe("vite exploded");
    });

    it("phase: contracts → contracts.deployStatus error + error set", () => {
        const s = runningReducer(baseState(), {
            kind: "error",
            phase: "contracts",
            message: "revert",
        });
        expect(s.contracts.deployStatus).toBe("error");
        expect(s.contracts.error).toBe("revert");
    });

    it("phase: storage-and-dotns → frontend.uploadStatus error + error set", () => {
        const s = runningReducer(baseState(), {
            kind: "error",
            phase: "storage-and-dotns",
            message: "ws halt",
        });
        expect(s.frontend.uploadStatus).toBe("error");
        expect(s.frontend.error).toBe("ws halt");
    });

    it("phase: playground → playground.status error + error set", () => {
        const s = runningReducer(baseState(), {
            kind: "error",
            phase: "playground",
            message: "registry revert",
        });
        expect(s.playground.status).toBe("error");
        expect(s.playground.error).toBe("registry revert");
    });
});

describe("runningReducer — log/signing/plan events are no-ops", () => {
    const s0 = baseState();

    it("plan → state unchanged (ref equality)", () => {
        const s = runningReducer(s0, { kind: "plan", approvals: [] });
        expect(s).toBe(s0);
    });

    it("build-log → state unchanged (ref equality)", () => {
        const s = runningReducer(s0, { kind: "build-log", line: "hello" });
        expect(s).toBe(s0);
    });

    it("signing sign-request → state unchanged", () => {
        const s = runningReducer(s0, {
            kind: "signing",
            event: { kind: "sign-request", step: 1, total: 3, label: "DotNS register" },
        });
        expect(s).toBe(s0);
    });

    it("storage-event chunk-progress → state unchanged", () => {
        const s = runningReducer(s0, {
            kind: "storage-event",
            event: { kind: "chunk-progress", current: 3, total: 10 },
        });
        expect(s).toBe(s0);
    });

    it("contracts-event info / compile-log → state unchanged (deep equality)", () => {
        const a = runningReducer(s0, {
            kind: "contracts-event",
            event: { kind: "info", message: "pinging" },
        });
        const b = runningReducer(s0, {
            kind: "contracts-event",
            event: { kind: "compile-log", line: "cargo build..." },
        });
        expect(a).toBe(s0);
        expect(b).toBe(s0);
    });
});

describe("runningReducer — full happy-path sequence", () => {
    it("realistic deploy with contracts, frontend build + upload, and playground publish", () => {
        let s = initialRunningState({
            deployContracts: true,
            skipBuild: false,
            publishToPlayground: true,
        });

        const events: DeployEvent[] = [
            { kind: "phase-start", phase: "contracts" },
            {
                kind: "contracts-event",
                event: { kind: "compile-detected", contracts: ["Flipper", "Counter"] },
            },
            {
                kind: "contracts-event",
                event: {
                    kind: "deploy-chunk",
                    chunk: 1,
                    total: 1,
                    contracts: [
                        { name: "Flipper", address: "0xaaa" as `0x${string}` },
                        { name: "Counter", address: "0xbbb" as `0x${string}` },
                    ],
                },
            },
            {
                kind: "contracts-event",
                event: {
                    kind: "deploy-done",
                    addresses: [
                        { name: "Flipper", address: "0xaaa" as `0x${string}` },
                        { name: "Counter", address: "0xbbb" as `0x${string}` },
                    ],
                },
            },
            { kind: "phase-complete", phase: "contracts" },
            { kind: "phase-start", phase: "build" },
            { kind: "phase-complete", phase: "build" },
            { kind: "phase-start", phase: "storage-and-dotns" },
            { kind: "phase-complete", phase: "storage-and-dotns" },
            { kind: "phase-start", phase: "playground" },
            { kind: "phase-complete", phase: "playground" },
        ];

        for (const e of events) s = runningReducer(s, e);

        expect(s.contracts.buildStatus).toBe("complete");
        expect(s.contracts.deployStatus).toBe("complete");
        expect(s.contracts.contracts).toEqual([
            { name: "Flipper", status: "complete", address: "0xaaa" },
            { name: "Counter", status: "complete", address: "0xbbb" },
        ]);
        expect(s.contracts.error).toBeUndefined();

        expect(s.frontend.buildStatus).toBe("complete");
        expect(s.frontend.uploadStatus).toBe("complete");
        expect(s.frontend.error).toBeUndefined();

        expect(s.playground.status).toBe("complete");
        expect(s.playground.error).toBeUndefined();
    });
});
