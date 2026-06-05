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

import { beforeEach, describe, expect, it, vi } from "vitest";

// Heavy underlying pieces mocked — the orchestrator test only cares about
// which signer reaches the Bulletin storage layer. Same pattern as
// `../deploy/run.test.ts`.
const { runStorageDeployMock, mirrorSiteMock, ensureSlotAccountSignerMock } = vi.hoisted(() => ({
    // Explicit arg type so `mock.calls[0][0]` typechecks (an arg-less vi.fn
    // infers Parameters = [] and indexing the empty tuple is a tsc error).
    runStorageDeployMock: vi.fn<
        (arg: unknown) => Promise<{
            domainName: string;
            fullDomain: string;
            cid: string;
            ipfsCid: string;
        }>
    >(async () => ({
        domainName: "my-site",
        fullDomain: "my-site.dot",
        cid: "bafysite",
        ipfsCid: "bafyipfs",
    })),
    mirrorSiteMock: vi.fn(async () => ({
        directory: "/tmp/playground-cli-test-mirror-does-not-exist",
        uploadRoot: "/tmp/playground-cli-test-mirror-does-not-exist",
        fileCount: 3,
    })),
    ensureSlotAccountSignerMock: vi.fn(),
}));

vi.mock("../deploy/storage.js", () => ({ runStorageDeploy: runStorageDeployMock }));
vi.mock("./mirror.js", () => ({ mirrorSite: mirrorSiteMock }));
vi.mock("@parity/product-sdk-terminal/host", () => ({
    createSlotAccountSigner: vi.fn(),
    ensureSlotAccountSigner: ensureSlotAccountSignerMock,
    // Slot key reported as cached so no grant prompt fires — these tests
    // exercise storage-signer routing, not the approval UI.
    getCachedAllocation: vi.fn(async () => ({ tag: "BulletInAllowance" })),
    requestResourceAllocation: vi.fn(),
}));
import { DEFAULT_MNEMONIC } from "bulletin-deploy";
import type { ResolvedSigner } from "../signer.js";
import { DEV_PUBLISH_ADDRESS } from "../deploy/signerMode.js";
import { describeDeployEvent, runDecentralize } from "./run.js";

describe("describeDeployEvent", () => {
    it("renders chunk-progress as a human-readable upload line", () => {
        expect(describeDeployEvent({ kind: "chunk-progress", current: 3, total: 7 })).toBe(
            "uploading chunk 3/7",
        );
    });

    it("passes info messages through verbatim", () => {
        expect(describeDeployEvent({ kind: "info", message: "reserving domain" })).toBe(
            "reserving domain",
        );
    });

    it("drops phase-start banners (step rows / phase headers convey those)", () => {
        // This is the bug the rewrite fixed: phase banners used to surface as
        // the raw "phase-start" string in the log tail.
        expect(describeDeployEvent({ kind: "phase-start", phase: "storage" })).toBeNull();
    });
});

describe("runDecentralize — Bulletin storage signer", () => {
    const SLOT_PUBLIC_KEY = new Uint8Array(32).fill(7);
    const slotSigner = { publicKey: SLOT_PUBLIC_KEY } as any;

    const sessionSigner: ResolvedSigner = {
        signer: {
            publicKey: new Uint8Array(32),
            signTx: vi.fn(),
            signBytes: vi.fn(),
        } as any,
        address: "5Fake",
        source: "session",
        userSession: {} as any,
        adapter: {} as any,
        addresses: {
            rootAddress: "5Root",
            productAddress: "5Fake",
            productH160: "0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef",
        },
        destroy: vi.fn(),
    };

    beforeEach(() => {
        runStorageDeployMock.mockClear();
        mirrorSiteMock.mockClear();
        ensureSlotAccountSignerMock.mockReset();
        ensureSlotAccountSignerMock.mockResolvedValue(slotSigner);
    });

    it("phone mode threads the slot key as storageSigner — chunks never phone-sign", async () => {
        await runDecentralize({
            siteUrl: "https://example.com",
            label: "my-site",
            fullDomain: "my-site.dot",
            mode: "phone",
            userSigner: sessionSigner,
            env: "paseo-next-v2",
        });

        expect(runStorageDeployMock).toHaveBeenCalledTimes(1);
        const arg = runStorageDeployMock.mock.calls[0][0] as unknown as {
            auth: {
                signerAddress?: string;
                storageSigner?: unknown;
                storageSignerAddress?: string;
            };
        };
        // DotNS keeps the phone signer...
        expect(arg.auth.signerAddress).toBe("5Fake");
        // ...but Bulletin storage signs with the local slot key.
        expect(arg.auth.storageSigner).toBe(slotSigner);
        expect(arg.auth.storageSignerAddress).toBeDefined();
        expect(arg.auth.storageSignerAddress).not.toBe("5Fake");
    });

    it("dev mode pins the dev mnemonic + dev storage signer and never touches the slot key", async () => {
        await runDecentralize({
            siteUrl: "https://example.com",
            label: "my-site",
            fullDomain: "my-site.dot",
            mode: "dev",
            userSigner: null,
            env: "paseo-next-v2",
        });

        const arg = runStorageDeployMock.mock.calls[0][0] as unknown as {
            auth: { mnemonic?: string; signer?: unknown; storageSignerAddress?: string };
        };
        // Explicit dev identity: an empty auth object would let bulletin-deploy
        // 0.8.x resolve the persisted phone session (DotNS taps) and the
        // user's cached slot key (quota burn). See signerMode.ts.
        expect(arg.auth.mnemonic).toBe(DEFAULT_MNEMONIC);
        expect(arg.auth.signer).toBeUndefined();
        expect(arg.auth.storageSignerAddress).toBe(DEV_PUBLISH_ADDRESS);
        expect(ensureSlotAccountSignerMock).not.toHaveBeenCalled();
    });
});
