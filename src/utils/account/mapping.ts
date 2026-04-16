/**
 * Revive account mapping — check and map SS58 to H160.
 *
 * Required for any EVM contract interaction on Asset Hub.
 * The user's own signer must sign map_account (not Alice).
 */

import { createInkSdk } from "@polkadot-api/sdk-ink";
import { ensureAccountMapped } from "@polkadot-apps/tx";
import type { PolkadotSigner } from "polkadot-api";
import type { PaseoClient } from "../connection.js";

export async function checkMapping(client: PaseoClient, address: string): Promise<boolean> {
    const inkSdk = createInkSdk(client.raw.assetHub, { atBest: true });
    return inkSdk.addressIsMapped(address);
}

export async function ensureMapped(
    client: PaseoClient,
    address: string,
    signer: PolkadotSigner,
): Promise<void> {
    const inkSdk = createInkSdk(client.raw.assetHub, { atBest: true });
    await ensureAccountMapped(address, signer, inkSdk, client.assetHub);
}
