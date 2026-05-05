import { describe, expect, it, beforeEach, vi } from "vitest";
import type { CdmJson } from "@polkadot-apps/contracts";
import { CDM_REGISTRY_ADDRESS } from "../config.js";

const { createContractFromClientMock, getAddressQueryMock } = vi.hoisted(() => ({
    createContractFromClientMock: vi.fn(),
    getAddressQueryMock: vi.fn(),
}));

vi.mock("@polkadot-apps/contracts", () => ({
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

function manifest(): CdmJson {
    return {
        targets: {
            target1: {
                "asset-hub": "wss://asset-hub.example",
                bulletin: "https://bulletin.example/ipfs",
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
    };
}

beforeEach(() => {
    createContractFromClientMock.mockReset();
    getAddressQueryMock.mockReset();
    createContractFromClientMock.mockResolvedValue({
        getAddress: { query: getAddressQueryMock },
    });
});

describe("resolveLiveContractAddresses", () => {
    it("queries the fixed CDM registry for requested libraries", async () => {
        getAddressQueryMock.mockResolvedValue({
            success: true,
            value: { isSome: true, value: liveAddress },
        });

        const assetHub = {} as any;
        const addresses = await resolveLiveContractAddresses(assetHub, [
            PLAYGROUND_REGISTRY_CONTRACT,
        ]);

        expect(addresses).toEqual({ [PLAYGROUND_REGISTRY_CONTRACT]: liveAddress });
        expect(createContractFromClientMock).toHaveBeenCalledWith(
            assetHub,
            CDM_REGISTRY_ADDRESS,
            expect.arrayContaining([
                expect.objectContaining({ name: "getAddress", type: "function" }),
            ]),
            expect.any(Object),
        );
        expect(getAddressQueryMock).toHaveBeenCalledWith(PLAYGROUND_REGISTRY_CONTRACT);
    });

    it("forwards defaultOrigin to createContractFromClient when provided", async () => {
        getAddressQueryMock.mockResolvedValue({
            success: true,
            value: { isSome: true, value: liveAddress },
        });

        const assetHub = {} as any;
        const origin = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
        await resolveLiveContractAddresses(assetHub, [PLAYGROUND_REGISTRY_CONTRACT], {
            defaultOrigin: origin,
        });

        expect(createContractFromClientMock).toHaveBeenCalledWith(
            assetHub,
            CDM_REGISTRY_ADDRESS,
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
            resolveLiveContractAddresses({} as any, [PLAYGROUND_REGISTRY_CONTRACT]),
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
            CDM_REGISTRY_ADDRESS,
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
            CDM_REGISTRY_ADDRESS,
            expect.any(Array),
            expect.objectContaining({ defaultOrigin: origin }),
        );
    });
});
