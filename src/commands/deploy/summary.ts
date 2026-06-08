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
 * Pure helpers that compute the human-readable summary the TUI shows after
 * the user answers every prompt. Kept separate from the Ink component so
 * unit tests don't need React in the module graph.
 */

import type { SignerMode, DeployApproval } from "../../utils/deploy/index.js";

export interface SummaryInputs {
    mode: SignerMode;
    domain: string;
    buildDir: string;
    skipBuild: boolean;
    /** Whether this deploy will run contract deploy + install before the frontend deploy. */
    deployContracts?: boolean;
    publishToPlayground: boolean;
    moddable?: boolean;
    repositoryUrl?: string | null;
    approvals: DeployApproval[];
    /**
     * SS58 of the account that will sign this deploy. Surfaced in the summary
     * so the user can verify it matches what `dot init` set up (the product
     * account derived from their mnemonic at `/product/{PLAYGROUND_PRODUCT_ID}/0`)
     * before signing anything. `undefined` when no signer is resolved.
     */
    signerAddress?: string;
    /**
     * H160 that will be recorded as the app's `owner` in the registry — set
     * only in dev mode + active session, where Alice (or another dev key)
     * signs the publish but the contract's `owner` parameter carries the
     * user's session H160. When present, the summary surfaces it so the
     * user knows the app will still appear in their MyApps view.
     */
    claimedOwnerH160?: string | null;
}

export interface SummaryView {
    headline: string;
    rows: Array<{ label: string; value: string }>;
    approvalLines: string[];
    /**
     * Expected tap count from the pre-deploy plan. An estimate, not a
     * promise: the DotNS plan can drift from what bulletin-deploy actually
     * submits, and RFC-0010 allowance taps are demand-driven. The runtime
     * counter therefore shows bare sequential steps with no total.
     */
    totalApprovals: number;
    /** Extra line shown under the approvals list for demand-driven taps the plan can't count. */
    approvalHint: string | null;
}

const MODE_LABEL: Record<SignerMode, string> = {
    dev: "Dev signer (no phone taps for upload)",
    phone: "Your phone signer",
};

export function buildSummaryView(input: SummaryInputs): SummaryView {
    const signerValue = input.signerAddress
        ? `${MODE_LABEL[input.mode]} (${input.signerAddress})`
        : MODE_LABEL[input.mode];
    const rows: SummaryView["rows"] = [
        { label: "Signer", value: signerValue },
        { label: "Build", value: input.skipBuild ? "skip (use existing)" : "rebuild first" },
        { label: "Build dir", value: input.buildDir },
        ...(input.deployContracts === undefined
            ? []
            : [
                  {
                      label: "Contracts",
                      value: input.deployContracts ? "deploy + install first" : "skip",
                  },
              ]),
        {
            label: "Publish",
            value: input.publishToPlayground ? "Playground + your apps" : "DotNS only",
        },
    ];
    if (input.publishToPlayground) {
        rows.push({
            label: "Moddable",
            value: input.moddable ? `yes — ${input.repositoryUrl}` : "no",
        });
        if (input.claimedOwnerH160) {
            // Dev mode + session: Alice signs the registry tx but the
            // user's H160 is recorded as owner. Surfacing it here is
            // what the spec promises: "Signing as Alice (dev). Your
            // account will be recorded as the app owner so the app
            // shows in MyApps."
            rows.push({
                label: "App owner",
                value: `your account (${input.claimedOwnerH160})`,
            });
        }
    }
    return {
        headline: `Deploying ${input.domain}`,
        rows,
        approvalLines: input.approvals.map((a, i) => `${i + 1}. ${a.label}`),
        totalApprovals: input.approvals.length,
        approvalHint:
            input.mode === "phone"
                ? input.deployContracts
                    ? "contract deploy and Bulletin allowance requests may add phone approvals"
                    : "your phone may also ask to grant or top up the Bulletin storage allowance"
                : null,
    };
}

/** Plain-text renderer — used for the non-interactive (`--signer … --domain … --buildDir … --playground …`) mode. */
export function renderSummaryText(view: SummaryView): string {
    const rows = view.rows.map((r) => `  ${r.label.padEnd(10)} ${r.value}`).join("\n");
    const approvals =
        view.totalApprovals === 0
            ? "  No phone approvals required."
            : [
                  `  Phone approvals expected: ${view.totalApprovals}`,
                  ...view.approvalLines.map((a) => `    ${a}`),
                  ...(view.approvalHint ? [`    (${view.approvalHint})`] : []),
              ].join("\n");
    return `${view.headline}\n\n${rows}\n\n${approvals}\n`;
}
