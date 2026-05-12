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

import { describe, expect, it, beforeEach, vi } from "vitest";
import type { CdmJson } from "@parity/product-sdk-contracts";

const { createContractFromClientMock, getAddressQueryMock } = vi.hoisted(() => ({
    createContractFromClientMock: vi.fn(),
    getAddressQueryMock: vi.fn(),
}));

vi.mock("@parity/product-sdk-contracts", () => ({
    createContractFromClient: (...args: unknown[]) => createContractFromClientMock(...args),
}));

import {
    PLAYGROUND_REGISTRY_CONTRACT,
    resolveLiveContractAddresses,
    withLiveContractAddresses,
    withRequiredLiveContractAddresses,
} from "./contractManifest.js";

const snapshotAddress = "0x1111111111111111111111111111111111111111";
const liveAddress = "0x2222222222222222222222222222222222222222";
const targetRegistryAddress = "0x4444444444444444444444444444444444444444";

function manifest(): CdmJson {
    return {
        targets: {
            target1: {
                "asset-hub": "wss://asset-hub.example",
                bulletin: "https://bulletin.example/ipfs",
                registry: targetRegistryAddress,
            },
        },
        dependencies: {
            target1: {
                [PLAYGROUND_REGISTRY_CONTRACT]: "latest",
            },
        },
        contracts: {
            target1: {
                [PLAYGROUND_REGISTRY_CONTRACT]: {
                    version: 6,
                    address: snapshotAddress,
                    abi: [],
                    metadataCid: "bafyregistry",
                },
                "@example/other": {
                    version: 1,
                    address: "0x3333333333333333333333333333333333333333",
                    abi: [],
                    metadataCid: "bafyother",
                },
            },
        },
    } as unknown as CdmJson;
}

beforeEach(() => {
    createContractFromClientMock.mockReset();
    getAddressQueryMock.mockReset();
    createContractFromClientMock.mockResolvedValue({
        getAddress: { query: getAddressQueryMock },
    });
});

describe("resolveLiveContractAddresses", () => {
    it("queries the registry selected by the cdm.json target", async () => {
        getAddressQueryMock.mockResolvedValue({
            success: true,
            value: { isSome: true, value: liveAddress },
        });

        const assetHub = {} as any;
        const addresses = await resolveLiveContractAddresses(manifest(), assetHub, [
            PLAYGROUND_REGISTRY_CONTRACT,
        ]);

        expect(addresses).toEqual({ [PLAYGROUND_REGISTRY_CONTRACT]: liveAddress });
        expect(createContractFromClientMock).toHaveBeenCalledWith(
            assetHub,
            targetRegistryAddress,
            expect.arrayContaining([
                expect.objectContaining({ name: "getAddress", type: "function" }),
            ]),
            expect.any(Object),
        );
        expect(getAddressQueryMock).toHaveBeenCalledWith(PLAYGROUND_REGISTRY_CONTRACT);
    });

    it("uses a stable read-only origin by default", async () => {
        getAddressQueryMock.mockResolvedValue({
            success: true,
            value: { isSome: true, value: liveAddress },
        });

        await resolveLiveContractAddresses(manifest(), {} as any, [PLAYGROUND_REGISTRY_CONTRACT]);

        expect(createContractFromClientMock).toHaveBeenCalledWith(
            expect.anything(),
            targetRegistryAddress,
            expect.any(Array),
            expect.objectContaining({ defaultOrigin: expect.any(String) }),
        );
    });

    it("forwards defaultOrigin to createContractFromClient when provided", async () => {
        getAddressQueryMock.mockResolvedValue({
            success: true,
            value: { isSome: true, value: liveAddress },
        });

        const assetHub = {} as any;
        const origin = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
        await resolveLiveContractAddresses(manifest(), assetHub, [PLAYGROUND_REGISTRY_CONTRACT], {
            defaultOrigin: origin,
        });

        expect(createContractFromClientMock).toHaveBeenCalledWith(
            assetHub,
            targetRegistryAddress,
            expect.any(Array),
            expect.objectContaining({ defaultOrigin: origin }),
        );
    });

    it("omits libraries when the live registry has no address", async () => {
        getAddressQueryMock.mockResolvedValue({
            success: true,
            value: { isSome: false, value: snapshotAddress },
        });

        await expect(
            resolveLiveContractAddresses(manifest(), {} as any, [PLAYGROUND_REGISTRY_CONTRACT]),
        ).resolves.toEqual({});
    });
});

describe("withLiveContractAddresses", () => {
    it("patches only the resolved contract address and leaves the snapshot untouched", async () => {
        getAddressQueryMock.mockResolvedValue({
            success: true,
            value: { isSome: true, value: liveAddress },
        });
        const original = manifest();

        const patched = await withLiveContractAddresses(original, {} as any, [
            PLAYGROUND_REGISTRY_CONTRACT,
        ]);

        expect(patched).not.toBe(original);
        expect(patched.contracts?.target1[PLAYGROUND_REGISTRY_CONTRACT].address).toBe(liveAddress);
        expect(original.contracts?.target1[PLAYGROUND_REGISTRY_CONTRACT].address).toBe(
            snapshotAddress,
        );
        expect(patched.contracts?.target1["@example/other"].address).toBe(
            "0x3333333333333333333333333333333333333333",
        );
    });

    it("returns the original manifest when no live address is available", async () => {
        getAddressQueryMock.mockResolvedValue({ success: false, value: null });
        const original = manifest();

        await expect(
            withLiveContractAddresses(original, {} as any, [PLAYGROUND_REGISTRY_CONTRACT]),
        ).resolves.toBe(original);
    });

    it("throws when a required live address is unavailable", async () => {
        getAddressQueryMock.mockResolvedValue({ success: false, value: null });

        await expect(
            withRequiredLiveContractAddresses(manifest(), {} as any, [
                PLAYGROUND_REGISTRY_CONTRACT,
            ]),
        ).rejects.toThrow(/CDM meta-registry did not return live address/);
    });

    it("forwards defaultOrigin through withLiveContractAddresses", async () => {
        getAddressQueryMock.mockResolvedValue({
            success: true,
            value: { isSome: true, value: liveAddress },
        });

        const assetHub = {} as any;
        const origin = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
        await withLiveContractAddresses(manifest(), assetHub, [PLAYGROUND_REGISTRY_CONTRACT], {
            defaultOrigin: origin,
        });

        expect(createContractFromClientMock).toHaveBeenCalledWith(
            assetHub,
            targetRegistryAddress,
            expect.any(Array),
            expect.objectContaining({ defaultOrigin: origin }),
        );
    });

    it("forwards defaultOrigin through withRequiredLiveContractAddresses", async () => {
        getAddressQueryMock.mockResolvedValue({
            success: true,
            value: { isSome: true, value: liveAddress },
        });

        const assetHub = {} as any;
        const origin = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
        await withRequiredLiveContractAddresses(
            manifest(),
            assetHub,
            [PLAYGROUND_REGISTRY_CONTRACT],
            { defaultOrigin: origin },
        );

        expect(createContractFromClientMock).toHaveBeenCalledWith(
            assetHub,
            targetRegistryAddress,
            expect.any(Array),
            expect.objectContaining({ defaultOrigin: origin }),
        );
    });
});
