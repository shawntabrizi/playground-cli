/**
 * Playground registry contract access.
 */

import { ContractManager } from "@polkadot-apps/contracts";
import type { ResolvedSigner } from "./signer.js";

import cdmJson from "../../cdm.json";

/**
 * Get a typed handle to the playground registry contract.
 */
export async function getRegistryContract(
    rawClient: Parameters<typeof ContractManager.fromClient>[1],
    signer: ResolvedSigner,
) {
    const manager = await ContractManager.fromClient(cdmJson, rawClient, {
        defaultSigner: signer.signer,
        defaultOrigin: signer.address,
    });
    return manager.getContract("@example/playground-registry");
}
