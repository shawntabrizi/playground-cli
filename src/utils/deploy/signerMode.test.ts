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

function fakeSigner(
    source: "dev" | "session",
    address = "5FakeAddress",
    productH160: `0x${string}` = "0xbeefbeefbeefbeefbeefbeefbeefbeefbeefbeef",
): ResolvedSigner {
    return {
        signer: {} as any,
        address,
        source,
        ...(source === "session"
            ? {
                  addresses: {
                      rootAddress: "5RootFake",
                      productAddress: address,
                      productH160,
                  },
              }
            : {}),
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

    it("publishToPlayground with active session signs as Alice but claims session H160 as owner — zero phone taps", () => {
        const user = fakeSigner("session", "5User", "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        const result = resolveSignerSetup({
            mode: "dev",
            userSigner: user,
            publishToPlayground: true,
        });
        // No playground approval — dev account signs, user taps nothing.
        expect(result.approvals).toEqual([]);
        // Publish signer is a constructed dev signer (Alice), NOT the session.
        expect(result.publishSigner).not.toBe(user);
        expect(result.publishSigner?.source).toBe("dev");
        // The user's H160 is claimed via the owner parameter so MyApps still
        // resolves their app even though Alice signed the tx.
        expect(result.claimedOwnerH160).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        // Dev mode keeps bulletin-deploy on its built-in default mnemonic.
        expect(result.bulletinDeployAuthOptions).toEqual({});
    });

    it("publishToPlayground without any signer falls back to pure Alice ownership", () => {
        // Pure dev: no `--suri`, no session. Alice publishes AS Alice (her
        // H160 ends up as both publisher and owner). The user explicitly
        // opted into throwaway dev mode.
        const result = resolveSignerSetup({
            mode: "dev",
            userSigner: null,
            publishToPlayground: true,
        });
        expect(result.approvals).toEqual([]);
        expect(result.publishSigner?.source).toBe("dev");
        expect(result.claimedOwnerH160).toBeNull();
    });

    it("dev SURI signer is forwarded to DotNS auth AND used as the publish signer", () => {
        const user = fakeSigner("dev", "5DevSuri");
        const result = resolveSignerSetup({
            mode: "dev",
            userSigner: user,
            publishToPlayground: true,
        });
        // SURI dev signers don't need a claimed owner — the SURI address IS
        // the user's chosen address, recorded as caller by default.
        expect(result.approvals).toEqual([]);
        expect(result.publishSigner).toBe(user);
        expect(result.claimedOwnerH160).toBeNull();
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
