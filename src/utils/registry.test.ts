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
import type { ResolvedSigner } from "./signer.js";
import cdmJson from "../../cdm.json";

const {
    createDevSignerMock,
    fromClientMock,
    getContractMock,
    withRequiredLiveContractAddressesMock,
} = vi.hoisted(() => ({
    createDevSignerMock: vi.fn(),
    fromClientMock: vi.fn(),
    getContractMock: vi.fn(),
    withRequiredLiveContractAddressesMock: vi.fn(),
}));

vi.mock("@parity/product-sdk-tx", () => ({
    createDevSigner: (...args: unknown[]) => createDevSignerMock(...args),
}));

vi.mock("@parity/product-sdk-contracts", () => ({
    ContractManager: {
        fromClient: (...args: unknown[]) => fromClientMock(...args),
    },
}));

vi.mock("./contractManifest.js", () => ({
    PLAYGROUND_REGISTRY_CONTRACT: "@w3s/playground-registry",
    READ_ONLY_QUERY_ORIGIN: "5ReadOnly",
    suppressReviveTraceNoise: (contract: unknown) => contract,
    withRequiredLiveContractAddresses: (...args: unknown[]) =>
        withRequiredLiveContractAddressesMock(...args),
}));

import { getReadOnlyRegistryContract, getRegistryContract } from "./registry.js";

const fakeSigner: ResolvedSigner = {
    signer: {} as any,
    address: "5Fake",
    source: "session",
    destroy: () => {},
};

beforeEach(() => {
    createDevSignerMock.mockReset();
    fromClientMock.mockReset();
    getContractMock.mockReset();
    withRequiredLiveContractAddressesMock.mockReset();
    createDevSignerMock.mockReturnValue("alice-signer");
    getContractMock.mockReturnValue({ publish: { tx: vi.fn() } });
    fromClientMock.mockResolvedValue({ getContract: getContractMock });
});

describe("getRegistryContract", () => {
    it("builds a signed manager with a live-patched manifest", async () => {
        const patchedManifest = { ...cdmJson, marker: "patched" };
        withRequiredLiveContractAddressesMock.mockResolvedValue(patchedManifest);
        const rawClient = {} as any;

        await getRegistryContract(rawClient, fakeSigner);

        expect(withRequiredLiveContractAddressesMock.mock.calls[0]).toEqual([
            cdmJson,
            rawClient,
            ["@w3s/playground-registry"],
        ]);
        expect(fromClientMock).toHaveBeenCalledWith(patchedManifest, rawClient, {
            defaultSigner: fakeSigner.signer,
            defaultOrigin: fakeSigner.address,
        });
        expect(getContractMock).toHaveBeenCalledWith("@w3s/playground-registry");
    });

    it("builds a read-only manager without a product signer", async () => {
        const patchedManifest = { ...cdmJson, marker: "patched" };
        withRequiredLiveContractAddressesMock.mockResolvedValue(patchedManifest);
        const rawClient = {} as any;

        await getReadOnlyRegistryContract(rawClient);

        expect(createDevSignerMock).toHaveBeenCalledWith("Alice");
        expect(withRequiredLiveContractAddressesMock.mock.calls[0]).toEqual([
            cdmJson,
            rawClient,
            ["@w3s/playground-registry"],
        ]);
        expect(fromClientMock).toHaveBeenCalledWith(patchedManifest, rawClient, {
            defaultSigner: "alice-signer",
            defaultOrigin: "5ReadOnly",
        });
    });

    it("throws a clear error when live lookup fails", async () => {
        withRequiredLiveContractAddressesMock.mockRejectedValue(new Error("registry unavailable"));
        const rawClient = {} as any;

        await expect(getRegistryContract(rawClient, fakeSigner)).rejects.toThrow(
            /MetaRegistryFailure/,
        );

        expect(fromClientMock).not.toHaveBeenCalled();
    });
});
