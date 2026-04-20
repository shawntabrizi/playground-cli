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
    publishToPlayground: boolean;
    approvals: DeployApproval[];
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
    return {
        headline: `Deploying ${input.domain}`,
        rows: [
            { label: "Signer", value: MODE_LABEL[input.mode] },
            { label: "Build", value: input.skipBuild ? "skip (use existing)" : "rebuild first" },
            { label: "Build dir", value: input.buildDir },
            {
                label: "Publish",
                value: input.publishToPlayground ? "Playground + your apps" : "DotNS only",
            },
        ],
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
