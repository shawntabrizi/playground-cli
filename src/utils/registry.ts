/**
 * Playground registry contract access.
 */

import { ContractManager, type CdmJson } from "@polkadot-apps/contracts";
import type { ResolvedSigner } from "./signer.js";
import { PLAYGROUND_REGISTRY_CONTRACT, withLiveContractAddresses } from "./contractManifest.js";
import { captureWarning } from "../telemetry.js";

import cdmJson from "../../cdm.json";

/**
 * Get a typed handle to the playground registry contract.
 */
export async function getRegistryContract(
    rawClient: Parameters<typeof ContractManager.fromClient>[1],
    signer: ResolvedSigner,
) {
    let manifest: CdmJson = cdmJson;
    try {
        manifest = await withLiveContractAddresses(cdmJson, rawClient, [
            PLAYGROUND_REGISTRY_CONTRACT,
        ]);
    } catch (err) {
        captureWarning("Live playground registry address lookup failed; using cdm.json snapshot", {
            error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200),
        });
    }

    const manager = await ContractManager.fromClient(manifest, rawClient, {
        defaultSigner: signer.signer,
        defaultOrigin: signer.address,
    });
    return manager.getContract(PLAYGROUND_REGISTRY_CONTRACT);
}
