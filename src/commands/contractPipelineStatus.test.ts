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

import { describe, expect, it } from "vitest";
import { ContractPipelineStatusAdapter } from "./contractPipelineStatus.js";

describe("ContractPipelineStatusAdapter", () => {
    it("tracks build, deploy, publish, and register status for CDM events", () => {
        const displayNames = new Map<string, string>();
        const adapter = new ContractPipelineStatusAdapter({
            onCdmPackageDetected: (crate, pkg) => displayNames.set(crate, pkg),
        });

        adapter.handleDeployEvent({
            type: "detect",
            layers: [["reputation"]],
            contracts: [
                {
                    name: "reputation",
                    cdmPackage: "@polkadot/reputation",
                    description: null,
                    authors: [],
                    homepage: null,
                    repository: null,
                    readmePath: null,
                    path: "/tmp/reputation",
                    dependsOnCrates: [],
                },
            ],
        });
        adapter.handleDeployEvent({ type: "build-start", crate: "reputation" });
        adapter.handleDeployEvent({
            type: "build-progress",
            crate: "reputation",
            compiled: 4,
            total: 8,
        });
        adapter.handleDeployEvent({
            type: "build-done",
            crate: "reputation",
            durationMs: 1200,
            bytecodeSize: 42_000,
        });
        adapter.handleDeployEvent({
            type: "deploy-register-start",
            crates: ["reputation"],
        });
        adapter.handleDeployEvent({
            type: "publish-start",
            crates: ["reputation"],
        });
        adapter.handleDeployEvent({
            type: "deploy-register-done",
            addresses: { reputation: "0x1111111111111111111111111111111111111111" },
            txHash: "0xabc",
            blockHash: "0xdef",
            durationMs: 2500,
        });
        adapter.handleDeployEvent({
            type: "publish-done",
            cids: { reputation: "bafy1234" },
            txHash: "0xpub",
            durationMs: 500,
        });

        expect(displayNames.get("reputation")).toBe("@polkadot/reputation");
        expect(adapter.statuses.get("reputation")).toMatchObject({
            state: "done",
            address: "0x1111111111111111111111111111111111111111",
            cid: "bafy1234",
            deployInProgress: false,
            publishInProgress: false,
            registerInProgress: false,
            deployTxHash: "0xabc",
            publishTxHash: "0xpub",
            bytecodeSize: 42_000,
        });
    });

    it("retains only a bounded sanitized log tail", () => {
        const adapter = new ContractPipelineStatusAdapter();

        for (let i = 0; i < 10; i++) {
            adapter.handleDeployEvent({
                type: "log",
                line: `\u001b[32mline ${i}\u001b[0m\r`,
            });
        }

        expect(adapter.logLines).toEqual(["line 5", "line 6", "line 7", "line 8", "line 9"]);
    });
});
