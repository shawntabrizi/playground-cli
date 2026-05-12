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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../utils/connection.js", () => ({
    getConnection: vi.fn(),
    destroyConnection: vi.fn(),
}));

const { safeDetectContractsType, computeContractsPhoneSigningNeeded, shouldResolveUserSigner } =
    await import("./index.js");

describe("shouldResolveUserSigner", () => {
    it("skips signer lookup for pure dev deploys", () => {
        expect(shouldResolveUserSigner({ mode: "dev" })).toBe(false);
    });

    it("loads the logged-in signer for dev deploys that publish to playground", () => {
        expect(shouldResolveUserSigner({ mode: "dev", publishToPlayground: true })).toBe(true);
    });

    it("loads a signer for phone mode", () => {
        expect(shouldResolveUserSigner({ mode: "phone" })).toBe(true);
    });

    it("loads a signer when a suri is supplied", () => {
        expect(shouldResolveUserSigner({ mode: "dev", suri: "//Alice" })).toBe(true);
    });
});

describe("safeDetectContractsType", () => {
    let tmp: string;

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), "pg-deploy-detect-"));
    });

    afterEach(() => {
        rmSync(tmp, { recursive: true, force: true });
    });

    it("returns null for an empty project directory", () => {
        expect(safeDetectContractsType(tmp)).toBeNull();
    });

    it("returns null when the project directory does not exist", () => {
        // `loadDetectInput` throws on a missing dir — the `safe-` prefix
        // exists precisely so we can swallow that and move on.
        const missing = join(tmp, "does-not-exist");
        expect(safeDetectContractsType(missing)).toBeNull();
    });

    it("detects foundry via foundry.toml", () => {
        writeFileSync(join(tmp, "foundry.toml"), "[profile.default]\n");
        expect(safeDetectContractsType(tmp)).toBe("foundry");
    });

    it("detects hardhat via hardhat.config.ts", () => {
        writeFileSync(join(tmp, "hardhat.config.ts"), "export default {};\n");
        expect(safeDetectContractsType(tmp)).toBe("hardhat");
    });

    it("detects cdm via pvm_contract in Cargo.toml", () => {
        writeFileSync(
            join(tmp, "Cargo.toml"),
            `[package]\nname = "demo"\nversion = "0.1.0"\n\n[dependencies]\npvm_contract = "0.1"\n`,
        );
        expect(safeDetectContractsType(tmp)).toBe("cdm");
    });

    it("returns null for a Cargo.toml without a pvm_contract dep", () => {
        writeFileSync(
            join(tmp, "Cargo.toml"),
            `[package]\nname = "demo"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0"\n`,
        );
        expect(safeDetectContractsType(tmp)).toBeNull();
    });
});

// Minimal shapes — we only exercise the branches that `computeContractsPhoneSigningNeeded`
// inspects (`source`). Everything else is load-bearing only inside the real deploy.
const devSigner: any = { source: "dev", address: "5Dev", signer: {}, destroy: () => {} };
const sessionSigner: any = {
    source: "session",
    address: "5Ses",
    signer: {},
    destroy: () => {},
};

describe("computeContractsPhoneSigningNeeded", () => {
    it("returns false when deployContracts is false", () => {
        const result = computeContractsPhoneSigningNeeded({
            deployContracts: false,
            userSigner: sessionSigner,
        });
        expect(result).toBe(false);
    });

    it("returns false when userSigner is null", () => {
        const result = computeContractsPhoneSigningNeeded({
            deployContracts: true,
            userSigner: null,
        });
        expect(result).toBe(false);
    });

    it("returns false for a dev signer", () => {
        const result = computeContractsPhoneSigningNeeded({
            deployContracts: true,
            userSigner: devSigner,
        });
        expect(result).toBe(false);
    });

    it("returns true for a session signer", () => {
        const result = computeContractsPhoneSigningNeeded({
            deployContracts: true,
            userSigner: sessionSigner,
        });
        expect(result).toBe(true);
    });
});
