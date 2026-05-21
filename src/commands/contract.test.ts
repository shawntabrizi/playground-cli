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

import { getRegistryAddress } from "@dotdm/env";
import { DEFAULT_MNEMONIC as BULLETIN_DEPLOY_DEFAULT_MNEMONIC } from "bulletin-deploy";
import { describe, expect, it } from "vitest";
import { getChainConfig } from "../config.js";
import {
    cdmPassthroughArgs,
    resolveContractDeployTarget,
    resolveContractSignerOptions,
} from "./contract.js";

describe("cdmPassthroughArgs", () => {
    it("returns arguments after the contract subcommand", () => {
        expect(
            cdmPassthroughArgs(
                ["node", "dot", "contract", "install", "@polkadot/reputation", "--name", "paseo"],
                "install",
            ),
        ).toEqual(["@polkadot/reputation", "--name", "paseo"]);
    });

    it("handles the install alias", () => {
        expect(
            cdmPassthroughArgs(
                ["node", "dot", "contract", "i", "@polkadot/reputation:3"],
                "install",
                ["i"],
            ),
        ).toEqual(["@polkadot/reputation:3"]);
    });

    it("falls back to the first matching subcommand without a contract parent", () => {
        expect(cdmPassthroughArgs(["node", "dot", "deploy", "--features", "ci"], "deploy")).toEqual(
            ["--features", "ci"],
        );
    });
});

describe("resolveContractDeployTarget", () => {
    it("uses the active playground chain by default", () => {
        const cfg = getChainConfig();
        expect(resolveContractDeployTarget({})).toEqual({
            assethubUrl: cfg.assetHubRpc,
            bulletinUrl: cfg.bulletinRpc,
            bulletinUrls: [cfg.bulletinRpc, ...cfg.bulletinRpcFallbacks],
            registryAddress: getRegistryAddress(cfg.env),
        });
    });

    it("accepts explicit endpoint and registry overrides", () => {
        expect(
            resolveContractDeployTarget({
                assethubUrl: "wss://asset.example",
                bulletinUrl: "wss://bulletin.example",
                registryAddress: "0x1111111111111111111111111111111111111111",
            }),
        ).toEqual({
            assethubUrl: "wss://asset.example",
            bulletinUrl: "wss://bulletin.example",
            bulletinUrls: ["wss://bulletin.example"],
            registryAddress: "0x1111111111111111111111111111111111111111",
        });
    });

    it("rejects non-H160 registry addresses", () => {
        expect(() => resolveContractDeployTarget({ registryAddress: "0x1234" })).toThrow(
            "Registry address must be a 20-byte hex address",
        );
    });
});

describe("resolveContractSignerOptions", () => {
    it("preserves the default contract signer behavior", () => {
        expect(resolveContractSignerOptions({})).toEqual({ suri: undefined });
    });

    it("uses the explicit SURI when no signer mode is selected", () => {
        expect(resolveContractSignerOptions({ suri: "//Bob" })).toEqual({ suri: "//Bob" });
    });

    it("uses bulletin-deploy's default dev mnemonic by default", () => {
        expect(resolveContractSignerOptions({ signer: "dev" })).toEqual({
            suri: BULLETIN_DEPLOY_DEFAULT_MNEMONIC,
        });
    });

    it("honors bulletin-deploy mnemonic environment overrides", () => {
        const previousDotnsMnemonic = process.env.DOTNS_MNEMONIC;
        const previousMnemonic = process.env.MNEMONIC;
        try {
            process.env.DOTNS_MNEMONIC = "dotns env mnemonic";
            process.env.MNEMONIC = "plain env mnemonic";
            expect(resolveContractSignerOptions({ signer: "dev" })).toEqual({
                suri: "dotns env mnemonic",
            });

            delete process.env.DOTNS_MNEMONIC;
            expect(resolveContractSignerOptions({ signer: "dev" })).toEqual({
                suri: "plain env mnemonic",
            });
        } finally {
            if (previousDotnsMnemonic === undefined) delete process.env.DOTNS_MNEMONIC;
            else process.env.DOTNS_MNEMONIC = previousDotnsMnemonic;
            if (previousMnemonic === undefined) delete process.env.MNEMONIC;
            else process.env.MNEMONIC = previousMnemonic;
        }
    });

    it("allows a custom local signer in dev mode", () => {
        expect(resolveContractSignerOptions({ signer: "dev", suri: "//Charlie" })).toEqual({
            suri: "//Charlie",
        });
    });

    it("rejects SURI with phone mode to avoid silently using a local signer", () => {
        expect(() => resolveContractSignerOptions({ signer: "phone", suri: "//Alice" })).toThrow(
            "--suri cannot be used with --signer phone",
        );
    });
});
