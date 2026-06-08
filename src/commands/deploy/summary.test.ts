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

    it("any single-entry approvals list renders one approval line (pure transform check)", () => {
        // This test exists to lock buildSummaryView's pass-through behaviour
        // for a one-element approvals list. The real-world dev+playground
        // path no longer produces a playground approval (Alice signs in-
        // process — see the next test), but the transform itself must
        // still render whatever it's given.
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

    it("dev mode with playground reports zero approvals when no claimed owner is set (pure-dev throwaway)", () => {
        // The actual runtime shape of resolveSignerSetup for dev mode:
        // approvals is empty because Alice signs the registry publish in
        // process. No "check your phone" callout should fire. This test
        // pins that behaviour at the summary-layer to catch a regression
        // where someone adds the playground approval back unconditionally.
        const view = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: true,
            approvals: [],
        });
        expect(view.totalApprovals).toBe(0);
        expect(view.approvalLines).toEqual([]);
        // Without claimedOwnerH160, no "App owner" row is added.
        expect(view.rows.find((r) => r.label === "App owner")).toBeUndefined();
    });

    it("dev mode with playground surfaces the claimed owner row when a session H160 is set", () => {
        // Headline scenario: user did `dot init`, chose dev signer mode.
        // The summary must tell them which H160 will be recorded as the
        // app owner so they can trust that MyApps will resolve their app
        // — without this row, the user sees "0 phone taps" and a blank
        // owner with no way to verify their identity will land on chain.
        const view = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: true,
            approvals: [],
            claimedOwnerH160: "0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef",
        });
        expect(view.totalApprovals).toBe(0);
        const ownerRow = view.rows.find((r) => r.label === "App owner");
        expect(ownerRow?.value).toContain("0xbeefbeef");
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

    it("surfaces the contract pre-step when the deploy flow owns the decision", () => {
        const view = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            deployContracts: true,
            publishToPlayground: false,
            approvals: [],
        });
        expect(view.rows.find((r) => r.label === "Contracts")?.value).toBe(
            "deploy + install first",
        );
    });

    it("rows stay limited to deploy-owned concerns", () => {
        const view = buildSummaryView({
            mode: "dev",
            domain: "my-app.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: false,
            approvals: [],
        });
        expect(view.rows.map((r) => r.label)).toEqual(["Signer", "Build", "Build dir", "Publish"]);
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
        expect(text).toContain("Phone approvals expected: 3");
        expect(text).toContain("1. Reserve domain");
        expect(text).toContain("3. Link content");
        // Phone mode flags the demand-driven allowance tap the plan can't count.
        expect(text).toContain("Bulletin storage allowance");
    });

    it("omits the allowance hint in dev mode — no phone taps ever happen there", () => {
        const view = buildSummaryView({
            mode: "dev",
            domain: "x.dot",
            buildDir: "dist",
            skipBuild: false,
            publishToPlayground: true,
            approvals: [{ phase: "playground", label: "Publish to Playground registry" }],
        });
        expect(view.approvalHint).toBeNull();
        expect(renderSummaryText(view)).not.toContain("Bulletin storage allowance");
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
