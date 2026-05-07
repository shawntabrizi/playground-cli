/**
 * Bulletin storage allowance — check and grant authorization.
 *
 * Testnet-only: Alice grants allowance. On mainnet this will
 * be handled differently (e.g. user pays or is pre-authorized).
 */

import { Enum } from "polkadot-api";
import { submitAndWatch, createDevSigner } from "@polkadot-apps/tx";
import type { PaseoClient } from "../connection.js";
import { remainingAuthorizationExtent } from "./authorizationExtent.js";

const AT_BEST = { at: "best" as const };

/** Number of transactions to authorize. */
export const BULLETIN_TRANSACTIONS = 1000;

/** Bytes to authorize (100 MB). */
export const BULLETIN_BYTES = 100_000_000n;

/** Re-authorize when remaining transactions drop below this. */
export const LOW_TX_THRESHOLD = 10;

export interface AllowanceStatus {
    authorized: boolean;
    remainingTxs: number;
    remainingBytes: bigint;
}

export async function checkAllowance(
    client: PaseoClient,
    address: string,
): Promise<AllowanceStatus> {
    const raw = await client.bulletin.query.TransactionStorage.Authorizations.getValue(
        Enum("Account", address),
        AT_BEST,
    );

    if (!raw) {
        return { authorized: false, remainingTxs: 0, remainingBytes: 0n };
    }

    const remaining = remainingAuthorizationExtent(raw.extent);
    return {
        authorized: true,
        remainingTxs: remaining.transactions,
        remainingBytes: remaining.bytes,
    };
}

export async function ensureAllowance(client: PaseoClient, address: string): Promise<void> {
    const status = await checkAllowance(client, address);
    if (status.authorized && status.remainingTxs >= LOW_TX_THRESHOLD) return;

    const alice = createDevSigner("Alice");
    await submitAndWatch(
        client.bulletin.tx.TransactionStorage.authorize_account({
            who: address,
            transactions: BULLETIN_TRANSACTIONS,
            bytes: BULLETIN_BYTES,
        }),
        alice,
    );
}
