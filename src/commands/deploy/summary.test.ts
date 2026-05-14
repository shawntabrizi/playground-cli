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
import { buildSummaryView, renderSummaryText } from "./summary.js";

describe("buildSummaryView", () => {
    it("dev mode without playground has zero approvals", () => {
        const view = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: false,
            approvals: [],
        });
        expect(view.totalApprovals).toBe(0);
        expect(view.approvalLines).toEqual([]);
        expect(view.rows.find((r) => r.label === "Publish")?.value).toBe("DotNS only");
    });

    it("dev mode with playground has exactly one approval", () => {
        const view = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: true,
            approvals: [{ phase: "playground", label: "Publish to Playground registry" }],
        });
        expect(view.totalApprovals).toBe(1);
        expect(view.approvalLines[0]).toMatch(/Publish to Playground registry/);
    });

    it("phone mode with playground has four approvals numbered 1-4", () => {
        const view = buildSummaryView({
            mode: "phone",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: true,
            approvals: [
                { phase: "dotns", label: "Reserve domain (DotNS commitment)" },
                { phase: "dotns", label: "Finalize domain (DotNS register)" },
                { phase: "dotns", label: "Link content (DotNS setContenthash)" },
                { phase: "playground", label: "Publish to Playground registry" },
            ],
        });
        expect(view.totalApprovals).toBe(4);
        expect(view.approvalLines).toEqual([
            "1. Reserve domain (DotNS commitment)",
            "2. Finalize domain (DotNS register)",
            "3. Link content (DotNS setContenthash)",
            "4. Publish to Playground registry",
        ]);
    });

    it("Build row reflects the skipBuild flag", () => {
        const rebuild = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: false,
            approvals: [],
        });
        expect(rebuild.rows.find((r) => r.label === "Build")?.value).toBe("rebuild first");

        const skip = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: true,
            publishToPlayground: false,
            approvals: [],
        });
        expect(skip.rows.find((r) => r.label === "Build")?.value).toBe("skip (use existing)");
    });

    it("omits Contracts row when contracts is undefined", () => {
        const view = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: false,
            approvals: [],
        });
        expect(view.rows.find((r) => r.label === "Contracts")).toBeUndefined();
    });

    it("Contracts row shows 'deploy (foundry)' for foundry + deploy true", () => {
        const view = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: false,
            approvals: [],
            contracts: { type: "foundry", deploy: true },
        });
        expect(view.rows.find((r) => r.label === "Contracts")?.value).toBe("deploy (foundry)");
    });

    it("Contracts row shows 'skip' when deploy is false regardless of type", () => {
        const view = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: false,
            approvals: [],
            contracts: { type: "hardhat", deploy: false },
        });
        expect(view.rows.find((r) => r.label === "Contracts")?.value).toBe("skip");
    });

    it("Contracts row shows 'deploy (cdm)' for cdm + deploy true", () => {
        const view = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: false,
            approvals: [],
            contracts: { type: "cdm", deploy: true },
        });
        expect(view.rows.find((r) => r.label === "Contracts")?.value).toBe("deploy (cdm)");
    });

    it("Contracts row is appended after signer/build/buildDir/publish", () => {
        const view = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: false,
            approvals: [],
            contracts: { type: "foundry", deploy: true },
        });
        expect(view.rows.map((r) => r.label)).toEqual([
            "Signer",
            "Build",
            "Build dir",
            "Publish",
            "Contracts",
        ]);
    });
});

describe("renderSummaryText", () => {
    it("renders 'No phone approvals required.' when empty", () => {
        const text = renderSummaryText(
            buildSummaryView({
                mode: "dev",
                domain: "my-app.dot",
                buildDir: "dist",
                skipBuild: false,
                publishToPlayground: false,
                approvals: [],
            }),
        );
        expect(text).toContain("No phone approvals required.");
    });

    it("includes Contracts row in rendered text when present", () => {
        const text = renderSummaryText(
            buildSummaryView({
                mode: "dev",
                domain: "my-app.dot",
                buildDir: "dist",
                skipBuild: false,
                publishToPlayground: false,
                approvals: [],
                contracts: { type: "foundry", deploy: true },
            }),
        );
        expect(text).toContain("Contracts");
        expect(text).toContain("deploy (foundry)");
    });

    it("lists numbered approvals when non-empty", () => {
        const text = renderSummaryText(
            buildSummaryView({
                mode: "phone",
                domain: "x.dot",
                buildDir: "dist",
                skipBuild: false,
                publishToPlayground: false,
                approvals: [
                    { phase: "dotns", label: "Reserve domain" },
                    { phase: "dotns", label: "Finalize domain" },
                    { phase: "dotns", label: "Link content" },
                ],
            }),
        );
        expect(text).toContain("Phone approvals required: 3");
        expect(text).toContain("1. Reserve domain");
        expect(text).toContain("3. Link content");
    });

    it("appends signerAddress to the Signer row when provided", () => {
        const view = buildSummaryView({
            mode: "phone",
            domain: "x.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: false,
            approvals: [],
            signerAddress: "5HRBs5m8KoWET9AAYp7CSkgKc61zHsUYGGcR1veEg8StJSYn",
        });
        const signerRow = view.rows.find((r) => r.label === "Signer");
        expect(signerRow?.value).toContain("Your phone signer");
        expect(signerRow?.value).toContain("5HRBs5m8KoWET9AAYp7CSkgKc61zHsUYGGcR1veEg8StJSYn");
    });

    it("omits address from the Signer row when signerAddress is undefined", () => {
        const view = buildSummaryView({
            mode: "dev",
            domain: "x.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: false,
            approvals: [],
        });
        const signerRow = view.rows.find((r) => r.label === "Signer");
        expect(signerRow?.value).toBe("Dev signer (no phone taps for upload)");
        expect(signerRow?.value).not.toMatch(/\(.+\)\s*\(/); // no trailing "(<addr>)"
    });
});
