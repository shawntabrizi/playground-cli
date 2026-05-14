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
import type { ContractsType } from "../../utils/build/detect.js";

export interface SummaryInputs {
    mode: SignerMode;
    domain: string;
    buildDir: string;
    skipBuild: boolean;
    publishToPlayground: boolean;
    moddable?: boolean;
    repositoryUrl?: string | null;
    approvals: DeployApproval[];
    /** Contract project kind + user's yes/no. Omit when no contracts were detected. */
    contracts?: { type: ContractsType; deploy: boolean };
    /**
     * SS58 of the account that will sign this deploy. Surfaced in the summary
     * so the user can verify it matches what `dot init` set up (the product
     * account derived from their mnemonic at `/product/{PLAYGROUND_PRODUCT_ID}/0`)
     * before signing anything. `undefined` when no signer is resolved — e.g.
     * pure dev mode without `--suri`, where bulletin-deploy uses its built-in
     * `DEFAULT_MNEMONIC` and we can't show that without replicating its key
     * derivation.
     */
    signerAddress?: string;
}

export interface SummaryView {
    headline: string;
    rows: Array<{ label: string; value: string }>;
    approvalLines: string[];
    totalApprovals: number;
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
    }
    if (input.contracts) {
        rows.push({
            label: "Contracts",
            value: input.contracts.deploy ? `deploy (${input.contracts.type})` : "skip",
        });
    }
    return {
        headline: `Deploying ${input.domain}`,
        rows,
        approvalLines: input.approvals.map((a, i) => `${i + 1}. ${a.label}`),
        totalApprovals: input.approvals.length,
    };
}

/** Plain-text renderer — used for the non-interactive (`--signer … --domain … --buildDir … --playground …`) mode. */
export function renderSummaryText(view: SummaryView): string {
    const rows = view.rows.map((r) => `  ${r.label.padEnd(10)} ${r.value}`).join("\n");
    const approvals =
        view.totalApprovals === 0
            ? "  No phone approvals required."
            : [
                  `  Phone approvals required: ${view.totalApprovals}`,
                  ...view.approvalLines.map((a) => `    ${a}`),
              ].join("\n");
    return `${view.headline}\n\n${rows}\n\n${approvals}\n`;
}
