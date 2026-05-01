import { describe, expect, it, beforeEach, vi } from "vitest";
import type { ResolvedSigner } from "./signer.js";
import cdmJson from "../../cdm.json";

const { captureWarningMock, fromClientMock, getContractMock, withLiveContractAddressesMock } =
    vi.hoisted(() => ({
        captureWarningMock: vi.fn(),
        fromClientMock: vi.fn(),
        getContractMock: vi.fn(),
        withLiveContractAddressesMock: vi.fn(),
    }));

vi.mock("@polkadot-apps/contracts", () => ({
    ContractManager: {
        fromClient: (...args: unknown[]) => fromClientMock(...args),
    },
}));

vi.mock("./contractManifest.js", () => ({
    PLAYGROUND_REGISTRY_CONTRACT: "@w3s/playground-registry",
    withLiveContractAddresses: (...args: unknown[]) => withLiveContractAddressesMock(...args),
}));

vi.mock("../telemetry.js", () => ({
    captureWarning: (...args: unknown[]) => captureWarningMock(...args),
}));

import { getRegistryContract } from "./registry.js";

const fakeSigner: ResolvedSigner = {
    signer: {} as any,
    address: "5Fake",
    source: "session",
    destroy: () => {},
};

beforeEach(() => {
    captureWarningMock.mockReset();
    fromClientMock.mockReset();
    getContractMock.mockReset();
    withLiveContractAddressesMock.mockReset();
    getContractMock.mockReturnValue({ publish: { tx: vi.fn() } });
    fromClientMock.mockResolvedValue({ getContract: getContractMock });
});

describe("getRegistryContract", () => {
    it("builds the manager with a live-patched manifest", async () => {
        const patchedManifest = { ...cdmJson, marker: "patched" };
        withLiveContractAddressesMock.mockResolvedValue(patchedManifest);
        const rawClient = {} as any;

        await getRegistryContract(rawClient, fakeSigner);

        expect(withLiveContractAddressesMock).toHaveBeenCalledWith(cdmJson, rawClient, [
            "@w3s/playground-registry",
        ]);
        expect(fromClientMock).toHaveBeenCalledWith(patchedManifest, rawClient, {
            defaultSigner: fakeSigner.signer,
            defaultOrigin: fakeSigner.address,
        });
        expect(getContractMock).toHaveBeenCalledWith("@w3s/playground-registry");
    });

    it("falls back to the cdm.json snapshot and warns when live lookup fails", async () => {
        withLiveContractAddressesMock.mockRejectedValue(new Error("registry unavailable"));
        const rawClient = {} as any;

        await getRegistryContract(rawClient, fakeSigner);

        expect(captureWarningMock).toHaveBeenCalledWith(
            "Live playground registry address lookup failed; using cdm.json snapshot",
            { error: "registry unavailable" },
        );
        expect(fromClientMock).toHaveBeenCalledWith(cdmJson, rawClient, {
            defaultSigner: fakeSigner.signer,
            defaultOrigin: fakeSigner.address,
        });
    });
});
