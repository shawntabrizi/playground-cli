#!/usr/bin/env bun
/**
 * CI probe for the dedicated funder's PAS balance on Paseo Asset Hub.
 *
 * Exit codes:
 *   0  balance >= threshold
 *   1  balance < threshold (→ workflow files / comments on a GitHub issue)
 *   2  unexpected error (RPC down, etc.) — treated like "low" by the workflow
 *
 * Output is key=value lines so the calling shell can grep + cut without a
 * JSON parser.
 */

import { getConnection, destroyConnection } from "../src/utils/connection.js";
import { DEDICATED_FUNDER_ADDRESS } from "../src/utils/account/funder.js";

const PLANCK_PER_PAS = 10_000_000_000n;
const THRESHOLD_PAS = 5000n;
const THRESHOLD_PLANCK = THRESHOLD_PAS * PLANCK_PER_PAS;

function formatPas(planck: bigint): string {
    const whole = planck / PLANCK_PER_PAS;
    const hundredths = (planck % PLANCK_PER_PAS) / (PLANCK_PER_PAS / 100n);
    return `${whole}.${hundredths.toString().padStart(2, "0")} PAS`;
}

async function main(): Promise<number> {
    const client = await getConnection();
    try {
        const account = await client.assetHub.query.System.Account.getValue(
            DEDICATED_FUNDER_ADDRESS,
            { at: "best" },
        );
        const free = account.data.free;
        console.log(`address=${DEDICATED_FUNDER_ADDRESS}`);
        console.log(`balance=${formatPas(free)}`);
        console.log(`balance_planck=${free}`);
        console.log(`threshold=${formatPas(THRESHOLD_PLANCK)}`);
        if (free < THRESHOLD_PLANCK) {
            console.log("status=low");
            return 1;
        }
        console.log("status=ok");
        return 0;
    } finally {
        // Releases the WebSocket so the process can exit cleanly.
        destroyConnection();
    }
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(2);
    });
