#!/usr/bin/env bun
/**
 * Register a domain on the live playground-registry contract with metadata
 * that points at a public GitHub repo, so `dot mod <domain>` has a stable
 * happy-path target for E2E tests.
 *
 * Defaults register `dot-cli-mod-fixture.dot` → `paritytech/Rock-Paper-Scissors`
 * signed by the dedicated E2E deployer (SIGNER from e2e/cli/fixtures/accounts.ts).
 * Same-owner re-publish is permitted by the registry contract, so subsequent
 * runs of this tool simply update the metadata in place.
 *
 * Usage:
 *   bun tools/register-mod-fixture.ts                                         # all defaults
 *   bun tools/register-mod-fixture.ts --domain foo.dot --repo https://...     # override
 *   bun tools/register-mod-fixture.ts --suri //Alice                          # custom signer
 *
 * Auto-tops-up SIGNER from the CLI's funder chain if balance is too low to
 * cover the publish extrinsic, matching the e2e setup behavior.
 */

import { resolveSigner } from "../src/utils/signer.js";
import { publishToPlayground } from "../src/utils/deploy/playground.js";
import { getConnection, destroyConnection } from "../src/utils/connection.js";
import { ensureFunded, checkBalance, MIN_BALANCE } from "../src/utils/account/funding.js";
import {
    DEDICATED_E2E_DEPLOYER_MNEMONIC,
} from "../e2e/cli/fixtures/accounts.js";

const DEFAULT_DOMAIN = "dot-cli-mod-fixture.dot";
const DEFAULT_REPO = "https://github.com/paritytech/Rock-Paper-Scissors";
const DEFAULT_SURI = `${DEDICATED_E2E_DEPLOYER_MNEMONIC}//e2e-deployer`;

const DOT = 10_000_000_000n;
/** Top-up target if SIGNER is short. Same as e2e setup. */
const TOPUP_TARGET = 500n * DOT;
const TOPUP_AMOUNT = 1000n * DOT;

interface Args {
    domain: string;
    repo: string;
    suri: string;
}

function parseArgs(argv: string[]): Args {
    const args: Args = { domain: DEFAULT_DOMAIN, repo: DEFAULT_REPO, suri: DEFAULT_SURI };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];
        if (arg === "--domain" && next) {
            args.domain = next;
            i++;
        } else if (arg === "--repo" && next) {
            args.repo = next;
            i++;
        } else if (arg === "--suri" && next) {
            args.suri = next;
            i++;
        } else if (arg === "--help" || arg === "-h") {
            console.log("Usage: bun tools/register-mod-fixture.ts [--domain X] [--repo Y] [--suri Z]");
            process.exit(0);
        } else {
            throw new Error(`Unknown arg: ${arg}`);
        }
    }
    return args;
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));

    console.log(`registering mod fixture`);
    console.log(`  domain  ${args.domain}`);
    console.log(`  repo    ${args.repo}`);

    const signer = await resolveSigner({ suri: args.suri });
    console.log(`  signer  ${signer.address} (${signer.source})`);
    console.log();

    try {
        const client = await getConnection();
        const balance = await checkBalance(client, signer.address, TOPUP_TARGET);
        console.log(`signer balance: ${balance.free / DOT} DOT`);
        if (!balance.sufficient) {
            console.log(`balance below ${TOPUP_TARGET / DOT} DOT — topping up by ${TOPUP_AMOUNT / DOT} DOT…`);
            await ensureFunded(client, signer.address, TOPUP_TARGET, TOPUP_AMOUNT);
            const after = await checkBalance(client, signer.address, MIN_BALANCE);
            console.log(`topped up: ${after.free / DOT} DOT`);
        }
        console.log();

        const result = await publishToPlayground({
            domain: args.domain,
            publishSigner: signer,
            repositoryUrl: args.repo,
            onLogEvent: (event) => {
                if (event.kind === "info") console.log(`  • ${event.message}`);
            },
        });

        console.log();
        console.log(`✓ published ${result.fullDomain}`);
        console.log(`  metadataCid  ${result.metadataCid}`);
        console.log(`  metadata     ${JSON.stringify(result.metadata)}`);
        console.log();
        console.log(`verify with: bun tools/probe-registry-resolution.ts ${result.fullDomain}`);
        return 0;
    } finally {
        signer.destroy();
        destroyConnection();
    }
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
        process.exit(2);
    });
