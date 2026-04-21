/**
 * Account funding — check balance and fund from Alice on testnet.
 *
 * Testnet-only: will be replaced for mainnet where users fund themselves.
 */

import { Enum } from "polkadot-api";
import { submitAndWatch, createDevSigner } from "@polkadot-apps/tx";
import type { PaseoClient } from "../connection.js";

const AT_BEST = { at: "best" as const };

/** 0.5 PAS — below this we consider the account underfunded. */
export const MIN_BALANCE = 5_000_000_000n;

/** 1 PAS — amount sent when funding. */
export const FUND_AMOUNT = 50_000_000_000n;

export interface BalanceStatus {
    free: bigint;
    sufficient: boolean;
}

export async function checkBalance(client: PaseoClient, address: string): Promise<BalanceStatus> {
    const account = await client.assetHub.query.System.Account.getValue(address, AT_BEST);
    const free = account.data.free;
    return { free, sufficient: free >= MIN_BALANCE };
}

export async function ensureFunded(client: PaseoClient, address: string): Promise<void> {
    const { sufficient } = await checkBalance(client, address);
    if (sufficient) return;

    const alice = createDevSigner("Alice");
    await submitAndWatch(
        client.assetHub.tx.Balances.transfer_keep_alive({
            dest: Enum("Id", address),
            value: FUND_AMOUNT,
        }),
        alice,
    );
}
