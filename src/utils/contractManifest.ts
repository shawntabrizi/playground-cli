import { createContractFromClient, type AbiEntry, type CdmJson } from "@polkadot-apps/contracts";
import type { HexString, PolkadotClient } from "polkadot-api";
import { CDM_REGISTRY_ADDRESS } from "../config.js";

export const PLAYGROUND_REGISTRY_CONTRACT = "@w3s/playground-registry";

const LIVE_CONTRACTS = [PLAYGROUND_REGISTRY_CONTRACT] as const;

// Keep this ABI local so live address resolution does not depend on CDM's
// higher-level runtime package shape.
const CDM_REGISTRY_ABI: AbiEntry[] = [
    {
        type: "function",
        name: "getAddress",
        inputs: [{ name: "contract_name", type: "string" }],
        outputs: [
            {
                name: "",
                type: "tuple",
                components: [
                    { name: "isSome", type: "bool" },
                    { name: "value", type: "address" },
                ],
            },
        ],
        stateMutability: "view",
    },
];

type OptionAddress = { isSome: boolean; value: HexString };

function defaultTargetHash(manifest: CdmJson): string {
    const [targetHash] = Object.keys(manifest.targets);
    if (!targetHash) throw new Error("No targets found in cdm.json");
    return targetHash;
}

export async function resolveLiveContractAddresses(
    assetHub: PolkadotClient,
    libraries: readonly string[] = LIVE_CONTRACTS,
): Promise<Record<string, HexString>> {
    const registry = await createContractFromClient(
        assetHub,
        CDM_REGISTRY_ADDRESS,
        CDM_REGISTRY_ABI,
    );
    const entries = await Promise.all(
        libraries.map(async (library): Promise<readonly [string, HexString | null]> => {
            const result = await registry.getAddress.query(library);
            if (!result.success) return [library, null];
            const address = result.value as OptionAddress;
            return [library, address.isSome ? address.value : null];
        }),
    );

    const addresses: Record<string, HexString> = {};
    for (const [library, address] of entries) {
        if (address) addresses[library] = address;
    }
    return addresses;
}

export async function withLiveContractAddresses(
    manifest: CdmJson,
    assetHub: PolkadotClient,
    libraries: readonly string[] = LIVE_CONTRACTS,
): Promise<CdmJson> {
    const liveAddresses = await resolveLiveContractAddresses(assetHub, libraries);
    if (Object.keys(liveAddresses).length === 0) return manifest;

    const patched = structuredClone(manifest);
    const contracts = patched.contracts?.[defaultTargetHash(patched)];
    if (!contracts) return manifest;

    for (const [library, address] of Object.entries(liveAddresses)) {
        const contract = contracts[library];
        if (contract) contract.address = address;
    }

    return patched;
}
