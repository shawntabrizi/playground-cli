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
import { computeTargetHash, type CdmJson } from "@dotdm/contracts";
import { DEFAULT_MNEMONIC as BULLETIN_DEPLOY_DEFAULT_MNEMONIC } from "bulletin-deploy";
import { describe, expect, it } from "vitest";
import { getChainConfig } from "../config.js";
import {
    parseContractInstallLibraryArg,
    resolveContractDeployTarget,
    resolveContractInstallTarget,
    resolveContractSignerOptions,
} from "./contract.js";

describe("parseContractInstallLibraryArg", () => {
    it("defaults to latest", () => {
        expect(parseContractInstallLibraryArg("@polkadot/reputation")).toEqual({
            library: "@polkadot/reputation",
            requestedVersion: "latest",
        });
    });

    it("parses explicit versions from the last colon", () => {
        expect(parseContractInstallLibraryArg("@polkadot/reputation:3")).toEqual({
            library: "@polkadot/reputation",
            requestedVersion: 3,
        });
    });

    it("treats non-numeric suffixes as part of the package name", () => {
        expect(parseContractInstallLibraryArg("@polkadot/reputation:beta")).toEqual({
            library: "@polkadot/reputation:beta",
            requestedVersion: "latest",
        });
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

describe("resolveContractInstallTarget", () => {
    it("uses the active playground chain by default", () => {
        const cfg = getChainConfig();
        const ipfsGatewayUrl = cfg.bulletinGateway;
        const registryAddress = getRegistryAddress(cfg.env);
        expect(resolveContractInstallTarget({})).toEqual({
            assethubUrl: cfg.assetHubRpc,
            ipfsGatewayUrl,
            registryAddress,
            targetHash: computeTargetHash(cfg.assetHubRpc, ipfsGatewayUrl, registryAddress),
            chainName: undefined,
        });
    });

    it("prefers the first cdm.json target when no explicit target is supplied", () => {
        const cdmJson: CdmJson = {
            targets: {
                abc123: {
                    "asset-hub": "wss://asset.example",
                    bulletin: "https://gateway.example/ipfs/",
                    registry: "0x1111111111111111111111111111111111111111",
                },
            },
            dependencies: {},
            contracts: {},
        };

        expect(resolveContractInstallTarget({}, cdmJson)).toEqual({
            assethubUrl: "wss://asset.example",
            ipfsGatewayUrl: "https://gateway.example/ipfs/",
            registryAddress: "0x1111111111111111111111111111111111111111",
            targetHash: "abc123",
            chainName: undefined,
        });
    });

    it("prefers a cdm.json target with dependencies when reinstalling", () => {
        const cdmJson: CdmJson = {
            targets: {
                empty: {
                    "asset-hub": "wss://empty.example",
                    bulletin: "https://empty.example/ipfs",
                    registry: "0x1111111111111111111111111111111111111111",
                },
                withDeps: {
                    "asset-hub": "wss://deps.example",
                    bulletin: "https://deps.example/ipfs",
                    registry: "0x2222222222222222222222222222222222222222",
                },
            },
            dependencies: {
                withDeps: {
                    "@polkadot/contexts": "latest",
                },
            },
            contracts: {},
        };

        expect(resolveContractInstallTarget({}, cdmJson)).toEqual({
            assethubUrl: "wss://deps.example",
            ipfsGatewayUrl: "https://deps.example/ipfs",
            registryAddress: "0x2222222222222222222222222222222222222222",
            targetHash: "withDeps",
            chainName: undefined,
        });
    });

    it("preserves legacy cdm.json target keys when resolving a saved target", () => {
        const cdmJson: CdmJson = {
            targets: {
                legacyHash: {
                    "asset-hub": "wss://asset.example",
                    bulletin: "https://gateway.example/ipfs",
                },
            },
            dependencies: {
                legacyHash: {
                    "@polkadot/contexts": "latest",
                },
            },
            contracts: {},
        };

        const target = resolveContractInstallTarget({}, cdmJson);
        expect(target.targetHash).toBe("legacyHash");
        expect(target.targetHash).not.toBe(
            computeTargetHash(target.assethubUrl, target.ipfsGatewayUrl, target.registryAddress),
        );
    });

    it("allows --name custom to reuse cdm.json target connection details", () => {
        const cdmJson: CdmJson = {
            targets: {
                abc123: {
                    "asset-hub": "wss://asset.example",
                    bulletin: "https://gateway.example/ipfs/",
                    registry: "0x1111111111111111111111111111111111111111",
                },
            },
            dependencies: {},
            contracts: {},
        };

        expect(resolveContractInstallTarget({ name: "custom" }, cdmJson)).toEqual({
            assethubUrl: "wss://asset.example",
            ipfsGatewayUrl: "https://gateway.example/ipfs/",
            registryAddress: "0x1111111111111111111111111111111111111111",
            targetHash: "abc123",
            chainName: undefined,
        });
    });

    it("accepts explicit endpoint and registry overrides", () => {
        expect(
            resolveContractInstallTarget({
                assethubUrl: "wss://asset.example",
                ipfsGatewayUrl: "https://gateway.example/ipfs/",
                registryAddress: "0x2222222222222222222222222222222222222222",
            }),
        ).toEqual({
            assethubUrl: "wss://asset.example",
            ipfsGatewayUrl: "https://gateway.example/ipfs/",
            registryAddress: "0x2222222222222222222222222222222222222222",
            targetHash: computeTargetHash(
                "wss://asset.example",
                "https://gateway.example/ipfs/",
                "0x2222222222222222222222222222222222222222",
            ),
            chainName: undefined,
        });
    });

    it("rejects non-H160 registry addresses", () => {
        expect(() => resolveContractInstallTarget({ registryAddress: "0x1234" })).toThrow(
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
