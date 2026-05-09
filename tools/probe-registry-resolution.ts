#!/usr/bin/env bun

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

/**
 * Diagnostic probe for issue paritytech/playground-cli#74.
 *
 * Compares the playground-registry address that the CDM meta-registry
 * currently resolves to (the path `dot mod` takes since 2026-04-30) against
 * the address baked into `cdm.json` (the path the e2e setup helper still
 * uses), and reports whether a target domain is registered against each.
 *
 * Usage:
 *   bun tools/probe-registry-resolution.ts                 # default domain
 *   bun tools/probe-registry-resolution.ts foo.dot         # custom domain
 *
 * Exit codes:
 *   0  probe completed (regardless of registration outcome)
 *   2  unexpected error (RPC down, type error, etc.)
 */

import { ContractManager, type CdmJson } from "@parity/product-sdk-contracts";
import { createDevSigner, getDevPublicKey } from "@parity/product-sdk-tx";
import { ss58Encode } from "@parity/product-sdk-address";
import type { HexString } from "polkadot-api";
import { getConnection, destroyConnection } from "../src/utils/connection.js";
import {
    PLAYGROUND_REGISTRY_CONTRACT,
    resolveLiveContractAddresses,
    withoutReviveTraceNoise,
} from "../src/utils/contractManifest.js";
import cdmJson from "../cdm.json";

const DEFAULT_DOMAIN = "rock-paper-scissors.dot";

function bakedAddress(manifest: CdmJson): HexString {
    const target = Object.keys(manifest.targets)[0];
    if (!target) throw new Error("cdm.json has no targets");
    const contract = manifest.contracts?.[target]?.[PLAYGROUND_REGISTRY_CONTRACT];
    if (!contract) throw new Error(`cdm.json has no ${PLAYGROUND_REGISTRY_CONTRACT} entry`);
    return contract.address as HexString;
}

function withAddressOverride(manifest: CdmJson, address: HexString): CdmJson {
    const patched = structuredClone(manifest);
    const target = Object.keys(patched.targets)[0]!;
    const contract = patched.contracts?.[target]?.[PLAYGROUND_REGISTRY_CONTRACT];
    if (contract) contract.address = address;
    return patched;
}

interface ProbeResult {
    success: boolean;
    isSome: boolean;
    value: string;
}

async function queryDomain(
    rawClient: Parameters<typeof ContractManager.fromClient>[1],
    address: HexString,
    domain: string,
): Promise<ProbeResult> {
    const manifest = withAddressOverride(cdmJson as unknown as CdmJson, address);
    const aliceSigner = createDevSigner("Alice");
    const aliceAddress = ss58Encode(getDevPublicKey("Alice"));
    const manager = await ContractManager.fromClient(manifest, rawClient, {
        defaultSigner: aliceSigner,
        defaultOrigin: aliceAddress,
    });
    const registry = manager.getContract(PLAYGROUND_REGISTRY_CONTRACT);
    const res = await withoutReviveTraceNoise(() => registry.getMetadataUri.query(domain));
    const tuple = res.value as { isSome?: boolean; value?: string } | undefined;
    return {
        success: (res as { success?: boolean }).success ?? true,
        isSome: tuple?.isSome ?? false,
        value: tuple?.value ?? "",
    };
}

async function main(): Promise<number> {
    const domain = process.argv[2] ?? process.env.DOMAIN ?? DEFAULT_DOMAIN;
    const baked = bakedAddress(cdmJson as unknown as CdmJson);

    console.log(`probing ${PLAYGROUND_REGISTRY_CONTRACT}`);
    console.log(`  network    paseo asset hub`);
    console.log(`  domain     ${domain}`);
    console.log(`  cdm.json   ${baked}`);

    const client = await getConnection();
    try {
        const liveMap = await resolveLiveContractAddresses(client.raw.assetHub);
        const live = liveMap[PLAYGROUND_REGISTRY_CONTRACT] ?? null;
        console.log(`  meta→live  ${live ?? "<none>"}`);
        console.log();

        if (!live) {
            console.log("meta-registry returned None — dot mod would throw BadRegistryLookup.");
        } else if (live.toLowerCase() === baked.toLowerCase()) {
            console.log("addresses match — dot mod and cdm.json snapshot point at the same contract.");
        } else {
            console.log("addresses DIVERGE — dot mod and cdm.json snapshot point at different contracts.");
        }
        console.log();

        const bakedRes = await queryDomain(client.raw.assetHub, baked, domain);
        console.log(`getMetadataUri(${domain}) @ baked  ${baked}`);
        console.log(`  isSome  = ${bakedRes.isSome}`);
        if (bakedRes.isSome) console.log(`  value   = ${bakedRes.value}`);

        if (live && live.toLowerCase() !== baked.toLowerCase()) {
            const liveRes = await queryDomain(client.raw.assetHub, live, domain);
            console.log();
            console.log(`getMetadataUri(${domain}) @ live   ${live}`);
            console.log(`  isSome  = ${liveRes.isSome}`);
            if (liveRes.isSome) console.log(`  value   = ${liveRes.value}`);
        }

        return 0;
    } finally {
        destroyConnection();
    }
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
        process.exit(2);
    });
