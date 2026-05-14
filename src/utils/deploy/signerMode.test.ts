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

import { describe, it, expect } from "vitest";
import { resolveSignerSetup } from "./signerMode.js";
import type { ResolvedSigner } from "../signer.js";

function fakeSigner(source: "dev" | "session", address = "5FakeAddress"): ResolvedSigner {
    return {
        signer: {} as any,
        address,
        source,
        destroy: () => {},
    };
}

describe("resolveSignerSetup — dev mode", () => {
    it("no publish, no funding → empty approvals, empty auth options, null publishSigner", () => {
        const result = resolveSignerSetup({
            mode: "dev",
            userSigner: null,
            publishToPlayground: false,
        });
        expect(result.approvals).toEqual([]);
        expect(result.bulletinDeployAuthOptions).toEqual({});
        expect(result.publishSigner).toBeNull();
    });

    it("publishToPlayground with session userSigner adds one playground approval and leaves auth empty", () => {
        const user = fakeSigner("session");
        const result = resolveSignerSetup({
            mode: "dev",
            userSigner: user,
            publishToPlayground: true,
        });
        expect(result.approvals).toEqual([
            { phase: "playground", label: "Publish to Playground registry" },
        ]);
        expect(result.publishSigner).toBe(user);
        // Dev mode keeps bulletin-deploy on its built-in default mnemonic.
        expect(result.bulletinDeployAuthOptions).toEqual({});
    });

    it("dev SURI signer is forwarded to DotNS auth for CI deploys", () => {
        const user = fakeSigner("dev", "5DevSuri");
        const result = resolveSignerSetup({
            mode: "dev",
            userSigner: user,
            publishToPlayground: true,
        });

        expect(result.approvals).toEqual([
            { phase: "playground", label: "Publish to Playground registry" },
        ]);
        expect(result.publishSigner).toBe(user);
        expect(result.bulletinDeployAuthOptions.signer).toBe(user.signer);
        expect(result.bulletinDeployAuthOptions.signerAddress).toBe("5DevSuri");
    });
});

describe("resolveSignerSetup — phone mode", () => {
    it("no userSigner throws a helpful message", () => {
        expect(() =>
            resolveSignerSetup({
                mode: "phone",
                userSigner: null,
                publishToPlayground: false,
            }),
        ).toThrow(/dot init|--signer dev/);
    });

    it("no plan + no publish → 3 DotNS approvals in exact order, auth options wired to user signer", () => {
        const user = fakeSigner("session", "5UserPhone");
        const result = resolveSignerSetup({
            mode: "phone",
            userSigner: user,
            publishToPlayground: false,
        });
        expect(result.approvals).toEqual([
            { phase: "dotns", label: "Reserve domain (DotNS commitment)" },
            { phase: "dotns", label: "Finalize domain (DotNS register)" },
            { phase: "dotns", label: "Link content (DotNS setContenthash)" },
        ]);
        expect(result.bulletinDeployAuthOptions.signer).toBe(user.signer);
        expect(result.bulletinDeployAuthOptions.signerAddress).toBe("5UserPhone");
        expect(result.publishSigner).toBeNull();
    });

    it("plan needs PoP upgrade → 4 approvals, PoP FIRST, then commitment/register/setContenthash", () => {
        const user = fakeSigner("session");
        const result = resolveSignerSetup({
            mode: "phone",
            userSigner: user,
            publishToPlayground: false,
            plan: { action: "register", needsPopUpgrade: true },
        });
        // Order is load-bearing: maybeWrapAuthForSigning labels the Nth
        // incoming signTx with approvals[N].
        expect(result.approvals).toEqual([
            { phase: "dotns", label: "Grant Proof of Personhood" },
            { phase: "dotns", label: "Reserve domain (DotNS commitment)" },
            { phase: "dotns", label: "Finalize domain (DotNS register)" },
            { phase: "dotns", label: "Link content (DotNS setContenthash)" },
        ]);
    });

    it("plan action=update → single setContenthash approval (no commitment/register)", () => {
        const user = fakeSigner("session");
        const result = resolveSignerSetup({
            mode: "phone",
            userSigner: user,
            publishToPlayground: false,
            plan: { action: "update", needsPopUpgrade: false },
        });
        expect(result.approvals).toEqual([
            { phase: "dotns", label: "Link content (DotNS setContenthash)" },
        ]);
    });

    it("publishToPlayground appends the playground entry after the DotNS entries", () => {
        const user = fakeSigner("session");
        const result = resolveSignerSetup({
            mode: "phone",
            userSigner: user,
            publishToPlayground: true,
        });
        expect(result.approvals).toEqual([
            { phase: "dotns", label: "Reserve domain (DotNS commitment)" },
            { phase: "dotns", label: "Finalize domain (DotNS register)" },
            { phase: "dotns", label: "Link content (DotNS setContenthash)" },
            { phase: "playground", label: "Publish to Playground registry" },
        ]);
        expect(result.publishSigner).toBe(user);
    });
});

describe("resolveSignerSetup — contracts funding", () => {
    it("phone mode + session userSigner + fundingNeeded → contracts-fund is FIRST", () => {
        const user = fakeSigner("session");
        const result = resolveSignerSetup({
            mode: "phone",
            userSigner: user,
            publishToPlayground: true,
            contractsFundingNeeded: true,
        });
        expect(result.approvals[0]).toEqual({
            phase: "contracts-fund",
            label: "Fund contract deploy session key",
        });
        // Remaining entries stay in their DotNS → playground order.
        expect(result.approvals.slice(1)).toEqual([
            { phase: "dotns", label: "Reserve domain (DotNS commitment)" },
            { phase: "dotns", label: "Finalize domain (DotNS register)" },
            { phase: "dotns", label: "Link content (DotNS setContenthash)" },
            { phase: "playground", label: "Publish to Playground registry" },
        ]);
    });

    it("dev mode + session userSigner (dev-suri variant) + fundingNeeded → contracts-fund still added", () => {
        // Dev mode with a session-sourced user signer is the --suri <phone-session>
        // shape: the top-up still needs a tap.
        const user = fakeSigner("session");
        const result = resolveSignerSetup({
            mode: "dev",
            userSigner: user,
            publishToPlayground: false,
            contractsFundingNeeded: true,
        });
        expect(result.approvals).toEqual([
            { phase: "contracts-fund", label: "Fund contract deploy session key" },
        ]);
    });

    it("dev-source userSigner + fundingNeeded → NO contracts-fund approval (local-key funding, no human)", () => {
        const user = fakeSigner("dev");
        const result = resolveSignerSetup({
            mode: "dev",
            userSigner: user,
            publishToPlayground: false,
            contractsFundingNeeded: true,
        });
        expect(result.approvals).toEqual([]);
    });

    it("null userSigner + fundingNeeded → NO contracts-fund approval (pure-dev path)", () => {
        const result = resolveSignerSetup({
            mode: "dev",
            userSigner: null,
            publishToPlayground: false,
            contractsFundingNeeded: true,
        });
        expect(result.approvals).toEqual([]);
    });

    it("contractsFundingNeeded=false never adds the contracts-fund approval", () => {
        const user = fakeSigner("session");
        const result = resolveSignerSetup({
            mode: "phone",
            userSigner: user,
            publishToPlayground: true,
            contractsFundingNeeded: false,
        });
        expect(result.approvals.some((a) => a.phase === "contracts-fund")).toBe(false);
    });
});
