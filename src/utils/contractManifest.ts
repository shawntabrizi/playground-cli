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

import {
    createContractFromClient,
    type AbiEntry,
    type CdmJson,
} from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { REGISTRY_ADDRESS, resolveTargetRegistryAddress } from "@dotdm/contracts";
import type { HexString, PolkadotClient } from "polkadot-api";

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

const REVIVE_TRACE_CALL_COMPAT_ERROR =
    "Incompatible runtime entry RuntimeCall(ReviveApi_trace_call)";

/**
 * sdk-ink dry-runs Revive contract calls with `ReviveApi.call`, then also tries
 * `ReviveApi.trace_call` to recover emitted events. Paseo Asset Hub currently
 * rejects that trace runtime entry, but the actual dry-run result still works,
 * so sdk-ink catches the trace failure and continues after printing the stack.
 * Registry calls do not need trace-derived events, so hide this known noise.
 */
export async function withoutReviveTraceNoise<T>(fn: () => Promise<T>): Promise<T> {
    const error = console.error;
    console.error = (...args: unknown[]) => {
        if (args.some((arg) => String(arg).includes(REVIVE_TRACE_CALL_COMPAT_ERROR))) return;
        error(...args);
    };
    try {
        return await fn();
    } finally {
        console.error = error;
    }
}

export function suppressReviveTraceNoise<T extends object>(contract: T): T {
    return new Proxy(contract, {
        get(target, prop, receiver) {
            const method = Reflect.get(target, prop, receiver);
            if (method === null || typeof method !== "object") return method;

            return new Proxy(method, {
                get(methodTarget, op, opReceiver) {
                    const value = Reflect.get(methodTarget, op, opReceiver);
                    if (
                        typeof value !== "function" ||
                        (op !== "query" && op !== "tx" && op !== "prepare")
                    ) {
                        return value;
                    }

                    return (...args: unknown[]) =>
                        withoutReviveTraceNoise(() =>
                            Promise.resolve(value.apply(methodTarget, args)),
                        );
                },
            });
        },
    });
}

function defaultTargetHash(manifest: CdmJson): string {
    const [targetHash] = Object.keys(manifest.targets);
    if (!targetHash) throw new Error("No targets found in cdm.json");
    return targetHash;
}

function defaultTarget(manifest: CdmJson): CdmJson["targets"][string] & { registry?: string } {
    const target = manifest.targets[defaultTargetHash(manifest)];
    if (!target) throw new Error("No targets found in cdm.json");
    return target;
}

function defaultRegistryAddress(manifest: CdmJson): HexString {
    return resolveTargetRegistryAddress(defaultTarget(manifest)) as HexString;
}

function patchContractAddresses(
    manifest: CdmJson,
    liveAddresses: Record<string, HexString>,
): CdmJson {
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

/**
 * Options for the meta-registry lookup. `defaultOrigin` is forwarded to the
 * underlying contract handle so the read-only `getAddress` dry-run uses the
 * caller's logged-in account instead of the dev fallback (Alice). Without it,
 * `@parity/product-sdk-contracts` emits a misleading `[contracts] No origin
 * configured` warning even when the user has signed in via `dot init`.
 */
export interface LiveContractLookupOptions {
    defaultOrigin?: string;
    registryAddress?: HexString;
}

export async function resolveLiveContractAddresses(
    assetHub: PolkadotClient,
    libraries: readonly string[] = LIVE_CONTRACTS,
    options: LiveContractLookupOptions = {},
): Promise<Record<string, HexString>> {
    const registryAddress = options.registryAddress ?? (REGISTRY_ADDRESS as HexString);
    const registry = await createContractFromClient(
        assetHub,
        paseo_asset_hub,
        registryAddress,
        CDM_REGISTRY_ABI,
        { defaultOrigin: options.defaultOrigin },
    );
    const entries = await withoutReviveTraceNoise(() =>
        Promise.all(
            libraries.map(async (library): Promise<readonly [string, HexString | null]> => {
                const result = await registry.getAddress.query(library);
                if (!result.success) return [library, null];
                const address = result.value as OptionAddress;
                return [library, address.isSome ? address.value : null];
            }),
        ),
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
    options: LiveContractLookupOptions = {},
): Promise<CdmJson> {
    const liveAddresses = await resolveLiveContractAddresses(assetHub, libraries, {
        ...options,
        registryAddress: options.registryAddress ?? defaultRegistryAddress(manifest),
    });
    return patchContractAddresses(manifest, liveAddresses);
}

export async function withRequiredLiveContractAddresses(
    manifest: CdmJson,
    assetHub: PolkadotClient,
    libraries: readonly string[] = LIVE_CONTRACTS,
    options: LiveContractLookupOptions = {},
): Promise<CdmJson> {
    const liveAddresses = await resolveLiveContractAddresses(assetHub, libraries, {
        ...options,
        registryAddress: options.registryAddress ?? defaultRegistryAddress(manifest),
    });
    const missing = libraries.filter((library) => !liveAddresses[library]);
    if (missing.length > 0) {
        throw new Error(`CDM meta-registry did not return live address for ${missing.join(", ")}`);
    }

    return patchContractAddresses(manifest, liveAddresses);
}
