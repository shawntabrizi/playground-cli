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

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks for the heavy underlying pieces. Orchestrator tests only care about
// sequencing, event shape, and error propagation. Declare mocks via
// `vi.hoisted()` so they're available when `vi.mock()` (itself hoisted) runs.
const {
    runStorageDeploy,
    publishToPlaygroundMock,
    runBuildMock,
    detectBuildConfigMock,
    loadDetectInputMock,
    detectContractsTypeMock,
    runContractsPhaseMock,
    getOrCreateSessionAccountMock,
    getConnectionMock,
    checkBalanceMock,
    pickFunderMock,
    submitAndWatchMock,
    withSpanMock,
} = vi.hoisted(() => ({
    runStorageDeploy: vi.fn<
        (arg: any) => Promise<{
            domainName: string;
            fullDomain: string;
            cid: string;
            ipfsCid: string;
        }>
    >(async () => ({
        domainName: "my-app",
        fullDomain: "my-app.dot",
        cid: "bafyapp",
        ipfsCid: "bafyipfs",
    })),
    publishToPlaygroundMock: vi.fn(async () => ({
        metadataCid: "bafymeta",
        fullDomain: "my-app.dot",
        metadata: {},
    })),
    runBuildMock: vi.fn(async () => ({ config: {} as any, outputDir: "/tmp/dist" })),
    detectBuildConfigMock: vi.fn(() => ({
        cmd: "pnpm",
        args: ["run", "build"],
        description: "pnpm run build",
        defaultOutputDir: "dist",
    })),
    loadDetectInputMock: vi.fn(() => ({
        packageJson: { scripts: { build: "vite build" } },
        lockfiles: new Set<string>(),
        configFiles: new Set<string>(),
        hasNodeModules: true,
    })),
    detectContractsTypeMock: vi.fn<() => "foundry" | "hardhat" | "cdm" | null>(() => null),
    runContractsPhaseMock: vi.fn<
        (arg: any) => Promise<{
            deployed: Array<{ name: string; address: `0x${string}` }>;
        }>
    >(async () => ({ deployed: [{ name: "Counter", address: "0xdeadbeef" }] })),
    getOrCreateSessionAccountMock: vi.fn(async () => ({
        info: {
            account: {
                ss58Address: "5SessionAddr",
                signer: { __sessionSigner: true },
            },
        },
        created: false,
    })),
    getConnectionMock: vi.fn(),
    checkBalanceMock: vi.fn<
        (
            client: unknown,
            address: string,
            min?: bigint,
        ) => Promise<{
            free: bigint;
            sufficient: boolean;
        }>
    >(async () => ({ free: 100_000_000_000n, sufficient: true })),
    submitAndWatchMock: vi.fn<(tx: unknown, signer: unknown) => Promise<unknown>>(async () => ({
        ok: true,
    })),
    pickFunderMock: vi.fn<
        (
            client: unknown,
            required: bigint,
        ) => Promise<{ name: string; address: string; signer: unknown } | null>
    >(async () => ({ name: "Alice", address: "5Alice", signer: { __funder: "Alice" } })),
    withSpanMock: vi.fn(async (_op: string, _name: string, _attrs: any, fn: any) => fn()),
}));

vi.mock("./storage.js", () => ({ runStorageDeploy }));
vi.mock("./playground.js", () => ({
    publishToPlayground: publishToPlaygroundMock,
    normalizeDomain: (d: string) => {
        const label = d.replace(/\.dot$/, "");
        return { label, fullDomain: `${label}.dot` };
    },
}));
vi.mock("../build/index.js", () => ({
    runBuild: runBuildMock,
    loadDetectInput: loadDetectInputMock,
    detectBuildConfig: detectBuildConfigMock,
    detectContractsType: detectContractsTypeMock,
}));
vi.mock("./contracts.js", () => ({
    runContractsPhase: runContractsPhaseMock,
}));
vi.mock("./session-account.js", () => ({
    getOrCreateSessionAccount: getOrCreateSessionAccountMock,
    persistSessionAccount: vi.fn(async () => {}),
    SESSION_MIN_BALANCE: 5_000_000_000n,
    SESSION_FUND_AMOUNT: 50_000_000_000n,
}));
vi.mock("../connection.js", () => ({
    getConnection: getConnectionMock,
}));
vi.mock("../account/funding.js", () => ({
    checkBalance: checkBalanceMock,
    pickFunder: (...args: unknown[]) => pickFunderMock(args[0], args[1] as bigint),
    FUNDER_FEE_BUFFER: 1_000_000_000n,
}));
vi.mock("../account/funder.js", () => ({
    FAUCET_URL: "https://faucet.polkadot.io/?network=pah",
}));
vi.mock("@parity/product-sdk-tx", () => ({
    submitAndWatch: (...args: unknown[]) => submitAndWatchMock(args[0], args[1]),
}));
vi.mock("../../telemetry.js", () => ({
    withSpan: (...args: unknown[]) =>
        withSpanMock(args[0] as string, args[1] as string, args[2], args[3]),
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import { runDeploy, type DeployEvent } from "./run.js";
import type { ResolvedSigner } from "../signer.js";

const fakeUserSigner: ResolvedSigner = {
    signer: {
        publicKey: new Uint8Array(32),
        signTx: vi.fn(),
        signBytes: vi.fn(),
    },
    address: "5Fake",
    source: "session",
    destroy: vi.fn(),
};

const fakeDevSigner: ResolvedSigner = {
    signer: {
        publicKey: new Uint8Array(32).fill(1),
        signTx: vi.fn(),
        signBytes: vi.fn(),
    },
    address: "5Dev",
    source: "dev",
    destroy: vi.fn(),
};

function collectEvents(): { events: DeployEvent[]; push: (e: DeployEvent) => void } {
    const events: DeployEvent[] = [];
    return { events, push: (e) => events.push(e) };
}

/**
 * Build a fake `PaseoClient`-ish object that exposes the exact tx factories
 * `maybeRunContracts` / `ensureSessionFunded` call (`Balances.transfer_keep_alive`,
 * `Revive.map_account`). Returns `transferFactory` and `mapAccountFactory` so
 * callers can assert what `submitAndWatch` was handed.
 */
function makeFakeClient() {
    const transferFactory = vi
        .fn()
        .mockImplementation((args: unknown) => ({ __kind: "transfer_keep_alive", args }));
    const mapAccountFactory = vi.fn().mockReturnValue({ __kind: "map_account" });
    return {
        client: {
            assetHub: {
                tx: {
                    Balances: { transfer_keep_alive: transferFactory },
                    Revive: { map_account: mapAccountFactory },
                },
            },
        } as any,
        transferFactory,
        mapAccountFactory,
    };
}

beforeEach(() => {
    runStorageDeploy.mockClear();
    publishToPlaygroundMock.mockClear();
    runBuildMock.mockClear();
    runContractsPhaseMock.mockClear();
    detectContractsTypeMock.mockReset();
    detectContractsTypeMock.mockReturnValue(null);
    getOrCreateSessionAccountMock.mockClear();
    getOrCreateSessionAccountMock.mockImplementation(async () => ({
        info: {
            account: {
                ss58Address: "5SessionAddr",
                signer: { __sessionSigner: true },
            },
        },
        created: false,
    }));
    getConnectionMock.mockReset();
    checkBalanceMock.mockReset();
    checkBalanceMock.mockResolvedValue({ free: 100_000_000_000n, sufficient: true });
    submitAndWatchMock.mockClear();
    withSpanMock.mockClear();
    pickFunderMock.mockReset();
    pickFunderMock.mockResolvedValue({
        name: "Alice",
        address: "5Alice",
        signer: { __funder: "Alice" },
    });
});

describe("runDeploy", () => {
    it("dev mode without playground: no phone taps, no publishToPlayground call", async () => {
        const { events, push } = collectEvents();
        const outcome = await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            domain: "my-app",
            mode: "dev",
            publishToPlayground: false,
            userSigner: null,
            onEvent: push,
        });

        expect(outcome.fullDomain).toBe("my-app.dot");
        expect(outcome.approvalsRequested).toEqual([]);
        expect(publishToPlaygroundMock).not.toHaveBeenCalled();

        const plan = events.find((e) => e.kind === "plan");
        expect(plan).toEqual({ kind: "plan", approvals: [] });

        // bulletin-deploy auth must be empty in dev mode.
        expect(runStorageDeploy).toHaveBeenCalledTimes(1);
        const arg = runStorageDeploy.mock.calls[0][0];
        expect(arg.auth).toEqual({});
        expect(arg.domainName).toBe("my-app");
    });

    it("dev mode with playground: 1 planned approval, calls publishToPlayground", async () => {
        const { events, push } = collectEvents();
        const outcome = await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            domain: "my-app",
            mode: "dev",
            publishToPlayground: true,
            userSigner: fakeUserSigner,
            onEvent: push,
        });

        expect(outcome.approvalsRequested).toEqual([
            { phase: "playground", label: "Publish to Playground registry" },
        ]);
        expect(outcome.metadataCid).toBe("bafymeta");
        expect(publishToPlaygroundMock).toHaveBeenCalledTimes(1);

        const plan = events.find((e) => e.kind === "plan");
        expect(plan?.kind).toBe("plan");
        if (plan?.kind === "plan") expect(plan.approvals).toHaveLength(1);
    });

    it("phone mode with playground: 4 planned approvals, DotNS uses phone signer", async () => {
        const { events, push } = collectEvents();
        const outcome = await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            domain: "my-app",
            mode: "phone",
            publishToPlayground: true,
            userSigner: fakeUserSigner,
            onEvent: push,
        });

        expect(outcome.approvalsRequested).toHaveLength(4);

        // bulletin-deploy auth must carry a wrapped signer + our address.
        const arg = runStorageDeploy.mock.calls[0][0];
        expect(arg.auth.signerAddress).toBe("5Fake");
        expect(arg.auth.signer).toBeDefined();

        const plan = events.find((e) => e.kind === "plan");
        if (plan?.kind === "plan") {
            expect(plan.approvals.map((a) => a.phase)).toEqual([
                "dotns",
                "dotns",
                "dotns",
                "playground",
            ]);
        }
    });

    it("phone mode + needsPopUpgrade: 5 planned approvals (setPop + commit + finalize + contenthash + playground)", async () => {
        // Regression: this used to be 4 approvals across the board, so a
        // PoP-gated name with a lower-tier signer (which triggers
        // `setUserPopStatus` inside bulletin-deploy.register) printed
        // "approve step 5 of 4" at the playground step.
        const { events, push } = collectEvents();
        const outcome = await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            domain: "my-app",
            mode: "phone",
            publishToPlayground: true,
            userSigner: fakeUserSigner,
            plan: { action: "register", needsPopUpgrade: true },
            onEvent: push,
        });

        expect(outcome.approvalsRequested).toHaveLength(5);
        expect(outcome.approvalsRequested.map((a) => a.label)).toEqual([
            "Grant Proof of Personhood",
            "Reserve domain (DotNS commitment)",
            "Finalize domain (DotNS register)",
            "Link content (DotNS setContenthash)",
            "Publish to Playground registry",
        ]);

        const plan = events.find((e) => e.kind === "plan");
        if (plan?.kind === "plan") {
            expect(plan.approvals.map((a) => a.phase)).toEqual([
                "dotns",
                "dotns",
                "dotns",
                "dotns",
                "playground",
            ]);
        }
    });

    it("phone mode + re-deploy (plan.action=update): only setContenthash + playground taps", async () => {
        // When the domain is already owned by the signer, bulletin-deploy
        // skips `register()` entirely (no commit, no reveal, no PoP grant)
        // and jumps straight to `setContenthash`. Summary should reflect that.
        const { events, push } = collectEvents();
        const outcome = await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            domain: "my-app",
            mode: "phone",
            publishToPlayground: true,
            userSigner: fakeUserSigner,
            plan: { action: "update", needsPopUpgrade: false },
            onEvent: push,
        });

        expect(outcome.approvalsRequested).toHaveLength(2);
        expect(outcome.approvalsRequested.map((a) => a.label)).toEqual([
            "Link content (DotNS setContenthash)",
            "Publish to Playground registry",
        ]);

        const plan = events.find((e) => e.kind === "plan");
        if (plan?.kind === "plan") {
            expect(plan.approvals.map((a) => a.phase)).toEqual(["dotns", "playground"]);
        }
    });

    it("phone mode without a logged-in session throws before touching the network", async () => {
        const { push } = collectEvents();
        await expect(
            runDeploy({
                projectDir: "/tmp/proj",
                buildDir: "/tmp/proj/dist",
                domain: "my-app",
                mode: "phone",
                publishToPlayground: false,
                userSigner: null,
                onEvent: push,
            }),
        ).rejects.toThrow(/Phone signer requested/);

        expect(runStorageDeploy).not.toHaveBeenCalled();
    });

    it("skipBuild bypasses detect + runBuild", async () => {
        const { push } = collectEvents();
        await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            skipBuild: true,
            domain: "my-app",
            mode: "dev",
            publishToPlayground: false,
            userSigner: null,
            onEvent: push,
        });
        expect(runBuildMock).not.toHaveBeenCalled();
    });

    it("emits error event and rethrows when storage fails", async () => {
        runStorageDeploy.mockImplementationOnce(async () => {
            throw new Error("bulletin rpc down");
        });
        const { events, push } = collectEvents();
        await expect(
            runDeploy({
                projectDir: "/tmp/proj",
                buildDir: "/tmp/proj/dist",
                skipBuild: true,
                domain: "my-app",
                mode: "dev",
                publishToPlayground: false,
                userSigner: null,
                onEvent: push,
            }),
        ).rejects.toThrow(/bulletin rpc down/);

        const err = events.find((e) => e.kind === "error");
        expect(err).toMatchObject({ phase: "storage-and-dotns", message: "bulletin rpc down" });
    });

    it("wraps build, storage, and playground phases in telemetry spans", async () => {
        const { push } = collectEvents();
        await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            domain: "my-app",
            mode: "dev",
            publishToPlayground: true,
            userSigner: fakeUserSigner,
            onEvent: push,
        });

        const ops = withSpanMock.mock.calls.map((call) => call[0]);
        expect(ops).toContain("cli.deploy.build");
        expect(ops).toContain("cli.deploy.storage-dotns");
        expect(ops).toContain("cli.deploy.playground");
    });
});

// ── Contracts-phase orchestration ────────────────────────────────────────────

describe("runDeploy — contracts phase", () => {
    it("runs contracts and build concurrently (both invoked before either resolves)", async () => {
        detectContractsTypeMock.mockReturnValue("foundry");
        const { client } = makeFakeClient();
        getConnectionMock.mockResolvedValue(client);

        // Gate each mock on an explicit resolver so we can observe that both
        // were *entered* before either has settled. If the orchestrator were
        // accidentally sequential (await-contracts → await-build), only the
        // first mock would ever be called within the assertion window.
        let resolveContracts!: () => void;
        const contractsGate = new Promise<void>((r) => {
            resolveContracts = r;
        });
        runContractsPhaseMock.mockImplementationOnce(async () => {
            await contractsGate;
            return { deployed: [{ name: "Counter", address: "0xabc" }] };
        });

        let resolveBuild!: () => void;
        const buildGate = new Promise<void>((r) => {
            resolveBuild = r;
        });
        runBuildMock.mockImplementationOnce(async () => {
            await buildGate;
            return { config: {} as any, outputDir: "/tmp/dist" };
        });

        const { push } = collectEvents();
        const deployPromise = runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            domain: "my-app",
            mode: "dev",
            publishToPlayground: false,
            userSigner: null,
            deployContracts: true,
            onEvent: push,
        });

        // Give microtasks + the Promise.all scheduler a window to invoke
        // both branches. Neither branch has resolved yet.
        await new Promise((r) => setTimeout(r, 20));
        expect(runContractsPhaseMock).toHaveBeenCalled();
        expect(runBuildMock).toHaveBeenCalled();

        resolveContracts();
        resolveBuild();
        const outcome = await deployPromise;
        expect(outcome.contracts).toEqual([{ name: "Counter", address: "0xabc" }]);
    });

    it("storage-and-dotns waits for BOTH contracts and build before starting", async () => {
        detectContractsTypeMock.mockReturnValue("foundry");
        const { client } = makeFakeClient();
        getConnectionMock.mockResolvedValue(client);

        let resolveContracts!: () => void;
        const contractsGate = new Promise<void>((r) => {
            resolveContracts = r;
        });
        runContractsPhaseMock.mockImplementationOnce(async () => {
            await contractsGate;
            return { deployed: [] };
        });

        let resolveBuild!: () => void;
        const buildGate = new Promise<void>((r) => {
            resolveBuild = r;
        });
        runBuildMock.mockImplementationOnce(async () => {
            await buildGate;
            return { config: {} as any, outputDir: "/tmp/dist" };
        });

        const { push } = collectEvents();
        const deployPromise = runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            domain: "my-app",
            mode: "dev",
            publishToPlayground: false,
            userSigner: null,
            deployContracts: true,
            onEvent: push,
        });

        // Resolve only contracts — storage must still be dormant because
        // build hasn't completed yet. Note: build precedes storage in the
        // frontend branch, so storage is always gated by build too.
        resolveContracts();
        await new Promise((r) => setTimeout(r, 20));
        expect(runStorageDeploy).not.toHaveBeenCalled();

        resolveBuild();
        await deployPromise;
        expect(runStorageDeploy).toHaveBeenCalledTimes(1);
    });

    it("deployContracts: false → phase-skipped with 'not requested' reason", async () => {
        const { events, push } = collectEvents();
        await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            skipBuild: true,
            domain: "my-app",
            mode: "dev",
            publishToPlayground: false,
            userSigner: null,
            onEvent: push,
        });

        const skipped = events.find((e) => e.kind === "phase-skipped" && e.phase === "contracts");
        expect(skipped).toMatchObject({
            kind: "phase-skipped",
            phase: "contracts",
            reason: expect.stringMatching(/contracts deploy not requested/),
        });
        expect(runContractsPhaseMock).not.toHaveBeenCalled();
    });

    it("deployContracts: true but no contracts project → phase-skipped with 'no foundry/hardhat/cdm' reason", async () => {
        detectContractsTypeMock.mockReturnValue(null);
        const { events, push } = collectEvents();
        await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            skipBuild: true,
            domain: "my-app",
            mode: "dev",
            publishToPlayground: false,
            userSigner: null,
            deployContracts: true,
            onEvent: push,
        });

        const skipped = events.find((e) => e.kind === "phase-skipped" && e.phase === "contracts");
        expect(skipped).toMatchObject({
            reason: expect.stringMatching(/no foundry\/hardhat\/cdm/),
        });
        expect(runContractsPhaseMock).not.toHaveBeenCalled();
    });

    it("ensureSessionFunded: already funded → no transfer submitted, contracts still run", async () => {
        detectContractsTypeMock.mockReturnValue("foundry");
        const { client } = makeFakeClient();
        getConnectionMock.mockResolvedValue(client);
        checkBalanceMock.mockResolvedValue({ free: 50_000_000_000n, sufficient: true });

        const { push } = collectEvents();
        await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            skipBuild: true,
            domain: "my-app",
            mode: "dev",
            publishToPlayground: false,
            userSigner: null,
            deployContracts: true,
            onEvent: push,
        });

        // `submitAndWatch` must not have been called for the transfer.
        // (It's also not called for map_account because `created: false`.)
        expect(submitAndWatchMock).not.toHaveBeenCalled();
        expect(runContractsPhaseMock).toHaveBeenCalledTimes(1);
    });

    it("ensureSessionFunded: underfunded + phone signer → wraps user signer, transfers SESSION_FUND_AMOUNT", async () => {
        detectContractsTypeMock.mockReturnValue("foundry");
        const { client, transferFactory } = makeFakeClient();
        getConnectionMock.mockResolvedValue(client);
        checkBalanceMock.mockResolvedValue({ free: 0n, sufficient: false });

        const { push } = collectEvents();
        await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            skipBuild: true,
            domain: "my-app",
            mode: "phone",
            publishToPlayground: false,
            userSigner: fakeUserSigner,
            deployContracts: true,
            onEvent: push,
        });

        // Transfer was submitted with `value = SESSION_FUND_AMOUNT` (50 PAS).
        const transferArg = transferFactory.mock.calls[0][0] as { value: bigint };
        expect(transferArg.value).toBe(50_000_000_000n);

        // The first `submitAndWatch` call is the transfer. Its signer is the
        // `wrapSignerWithEvents` proxy, which exposes `signTx`/`signBytes`
        // (so we check identity-by-shape rather than drilling into internals).
        const [, firstSigner] = submitAndWatchMock.mock.calls[0];
        expect(firstSigner).toHaveProperty("signTx");
        expect(firstSigner).toHaveProperty("signBytes");
        // Dev-mode funder-chain lookup must NOT have fired.
        expect(pickFunderMock).not.toHaveBeenCalled();
    });

    it("ensureSessionFunded: underfunded + dev signer (source='dev') → uses signer directly, no phone events", async () => {
        detectContractsTypeMock.mockReturnValue("foundry");
        const { client, transferFactory } = makeFakeClient();
        getConnectionMock.mockResolvedValue(client);
        checkBalanceMock.mockResolvedValue({ free: 0n, sufficient: false });

        const { events, push } = collectEvents();
        await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            skipBuild: true,
            domain: "my-app",
            mode: "dev",
            publishToPlayground: false,
            userSigner: fakeDevSigner,
            deployContracts: true,
            onEvent: push,
        });

        // Transfer was submitted — the dev signer funded the session key.
        const transferArg = transferFactory.mock.calls[0][0] as { value: bigint };
        expect(transferArg.value).toBe(50_000_000_000n);

        // The signer passed to submitAndWatch must be the raw dev signer — NOT
        // a wrapSignerWithEvents proxy. Assert exact object identity.
        const [, usedFunder] = submitAndWatchMock.mock.calls[0];
        expect(usedFunder).toBe(fakeDevSigner.signer);

        // No phone-tap lifecycle events should have been emitted.
        const signingEvents = events.filter((e) => e.kind === "signing");
        expect(signingEvents).toHaveLength(0);

        // Funder-chain lookup must NOT have been consulted.
        expect(pickFunderMock).not.toHaveBeenCalled();
    });

    it("ensureSessionFunded: underfunded + pure dev mode → picks a funder from the chain", async () => {
        detectContractsTypeMock.mockReturnValue("foundry");
        const { client } = makeFakeClient();
        getConnectionMock.mockResolvedValue(client);
        checkBalanceMock.mockResolvedValue({ free: 0n, sufficient: false });

        const dedicatedSigner = { __funder: "dedicated" };
        pickFunderMock.mockResolvedValueOnce({
            name: "dedicated",
            address: "5Dedicated",
            signer: dedicatedSigner,
        });

        const { push } = collectEvents();
        await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            skipBuild: true,
            domain: "my-app",
            mode: "dev",
            publishToPlayground: false,
            userSigner: null,
            deployContracts: true,
            onEvent: push,
        });

        // Funder-chain was consulted for `SESSION_FUND_AMOUNT + FUNDER_FEE_BUFFER`.
        expect(pickFunderMock).toHaveBeenCalledTimes(1);
        const required = pickFunderMock.mock.calls[0][1];
        expect(required).toBe(50_000_000_000n + 1_000_000_000n);

        // Transfer was submitted with exactly the signer returned by pickFunder.
        const [, funder] = submitAndWatchMock.mock.calls[0];
        expect(funder).toBe(dedicatedSigner);
    });

    it("ensureSessionFunded: underfunded + dev mode + every funder drained → throws with faucet link", async () => {
        detectContractsTypeMock.mockReturnValue("foundry");
        const { client } = makeFakeClient();
        getConnectionMock.mockResolvedValue(client);
        checkBalanceMock.mockResolvedValue({ free: 0n, sufficient: false });
        pickFunderMock.mockResolvedValueOnce(null);

        const { events, push } = collectEvents();
        await expect(
            runDeploy({
                projectDir: "/tmp/proj",
                buildDir: "/tmp/proj/dist",
                skipBuild: true,
                domain: "my-app",
                mode: "dev",
                publishToPlayground: false,
                userSigner: null,
                deployContracts: true,
                onEvent: push,
            }),
        ).rejects.toThrow(
            /Dev account balance low\..*mobile signer.*faucet.*https:\/\/faucet\.polkadot\.io/s,
        );

        // No transfer should have been attempted.
        expect(submitAndWatchMock).not.toHaveBeenCalled();
        // The error should have been surfaced as a contracts-phase error event.
        const err = events.find((e) => e.kind === "error" && e.phase === "contracts");
        expect(err).toBeDefined();
    });

    it("session-key mapping fires Revive.map_account only when created: true", async () => {
        detectContractsTypeMock.mockReturnValue("foundry");
        const { client, mapAccountFactory } = makeFakeClient();
        getConnectionMock.mockResolvedValue(client);
        getOrCreateSessionAccountMock.mockResolvedValue({
            info: {
                account: {
                    ss58Address: "5SessionAddr",
                    signer: { __sessionSigner: true },
                },
            },
            created: true,
        });

        const { push } = collectEvents();
        await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            skipBuild: true,
            domain: "my-app",
            mode: "dev",
            publishToPlayground: false,
            userSigner: null,
            deployContracts: true,
            onEvent: push,
        });

        expect(mapAccountFactory).toHaveBeenCalledTimes(1);
    });

    it("session-key mapping does NOT fire when created: false", async () => {
        detectContractsTypeMock.mockReturnValue("foundry");
        const { client, mapAccountFactory } = makeFakeClient();
        getConnectionMock.mockResolvedValue(client);
        getOrCreateSessionAccountMock.mockResolvedValue({
            info: {
                account: {
                    ss58Address: "5SessionAddr",
                    signer: { __sessionSigner: true },
                },
            },
            created: false,
        });

        const { push } = collectEvents();
        await runDeploy({
            projectDir: "/tmp/proj",
            buildDir: "/tmp/proj/dist",
            skipBuild: true,
            domain: "my-app",
            mode: "dev",
            publishToPlayground: false,
            userSigner: null,
            deployContracts: true,
            onEvent: push,
        });

        expect(mapAccountFactory).not.toHaveBeenCalled();
    });

    it("contracts phase error → runDeploy rejects AND emits a contracts error event", async () => {
        detectContractsTypeMock.mockReturnValue("foundry");
        const { client } = makeFakeClient();
        getConnectionMock.mockResolvedValue(client);
        runContractsPhaseMock.mockImplementationOnce(async () => {
            throw new Error("forge blew up");
        });

        const { events, push } = collectEvents();
        await expect(
            runDeploy({
                projectDir: "/tmp/proj",
                buildDir: "/tmp/proj/dist",
                skipBuild: true,
                domain: "my-app",
                mode: "dev",
                publishToPlayground: false,
                userSigner: null,
                deployContracts: true,
                onEvent: push,
            }),
        ).rejects.toThrow(/forge blew up/);

        const err = events.find((e) => e.kind === "error" && e.phase === "contracts");
        expect(err).toMatchObject({
            kind: "error",
            phase: "contracts",
            message: "forge blew up",
        });
    });
});
