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

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { resolveFeatures, type PipelineChainClient } from "@dotdm/contracts";
import { getRegistryAddress } from "@dotdm/env";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { paseo_bulletin } from "@parity/product-sdk-descriptors/paseo-bulletin";
import { DEFAULT_MNEMONIC as BULLETIN_DEPLOY_DEFAULT_MNEMONIC } from "bulletin-deploy";
import { Command, Option } from "commander";
import { createClient, type HexString, type SS58String } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { runCliCommand } from "../cli-runtime.js";
import { getChainConfig } from "../config.js";
import { getBulletinAllowanceSigner } from "../utils/allowances/bulletin.js";
import { ensureSmartContractAllowance } from "../utils/allowances/smartContracts.js";
import type { SignerMode } from "../utils/deploy/signerMode.js";
import { onProcessShutdown } from "../utils/process-guard.js";
import { resolveSigner, type ResolvedSigner, type SignerOptions } from "../utils/signer.js";
import { runContractDeployWithUI } from "./contractDeployUi.js";

type CdmSubcommand = "deploy" | "install";

interface ContractDeployOpts {
    assethubUrl?: string;
    bulletinUrl?: string;
    registryAddress?: string;
    signer?: SignerMode;
    suri?: string;
    features?: string;
}

interface ContractInstallOpts {
    assethubUrl?: string;
    name?: string;
    ipfsGatewayUrl?: string;
    registryAddress?: string;
}

interface ContractDeployTarget {
    assethubUrl: string;
    bulletinUrl: string;
    bulletinUrls: string[];
    registryAddress: HexString;
}

type ContractChainClient = PipelineChainClient & { destroy(): void };

export function cdmPassthroughArgs(
    argv: string[],
    subcommand: CdmSubcommand,
    aliases: string[] = [],
): string[] {
    const contractIndex = argv.indexOf("contract");
    const startAt = contractIndex === -1 ? 0 : contractIndex + 1;
    const subcommandNames = new Set([subcommand, ...aliases]);
    const subcommandIndex = argv.findIndex(
        (arg, index) => index >= startAt && subcommandNames.has(arg),
    );
    return subcommandIndex === -1 ? [] : argv.slice(subcommandIndex + 1);
}

async function runCdmSubprocess(subcommand: CdmSubcommand, args: string[]): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn("cdm", [subcommand, ...args], {
            stdio: "inherit",
            env: process.env,
        });

        child.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT") {
                reject(new Error('cdm is not installed. Run "dot init" or install CDM manually.'));
                return;
            }
            reject(err);
        });

        child.on("close", (code, signal) => {
            if (signal) {
                process.exitCode = signal === "SIGINT" ? 130 : 1;
                resolve();
                return;
            }
            process.exitCode = code ?? 1;
            resolve();
        });
    });
}

function assertHexAddress(value: string, label: string): HexString {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
        throw new Error(`${label} must be a 20-byte hex address`);
    }
    return value as HexString;
}

export function resolveContractSignerOptions(opts: ContractDeployOpts): SignerOptions {
    if (opts.signer === "dev") {
        return {
            suri:
                opts.suri ??
                process.env.DOTNS_MNEMONIC ??
                process.env.MNEMONIC ??
                BULLETIN_DEPLOY_DEFAULT_MNEMONIC,
        };
    }
    if (opts.signer === "phone") {
        if (opts.suri) {
            throw new Error(
                "--suri cannot be used with --signer phone. Use --signer dev --suri <suri> for local signing.",
            );
        }
        return {};
    }
    return { suri: opts.suri };
}

export function resolveContractDeployTarget(opts: ContractDeployOpts): ContractDeployTarget {
    const cfg = getChainConfig();
    const bulletinUrl = opts.bulletinUrl ?? cfg.bulletinRpc;
    return {
        assethubUrl: opts.assethubUrl ?? cfg.assetHubRpc,
        bulletinUrl,
        bulletinUrls: opts.bulletinUrl
            ? [opts.bulletinUrl]
            : [bulletinUrl, ...cfg.bulletinRpcFallbacks],
        registryAddress: assertHexAddress(
            opts.registryAddress ?? getRegistryAddress(cfg.env),
            "Registry address",
        ),
    };
}

async function createContractChainClient(
    target: ContractDeployTarget,
): Promise<ContractChainClient> {
    const raw = {
        assetHub: createClient(getWsProvider([target.assethubUrl])),
        bulletin: createClient(getWsProvider(target.bulletinUrls)),
    };
    let destroyed = false;
    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        raw.assetHub.destroy();
        raw.bulletin.destroy();
    };

    try {
        await Promise.all([raw.assetHub.getChainSpecData(), raw.bulletin.getChainSpecData()]);
    } catch (err) {
        destroy();
        throw err;
    }

    return {
        assetHub: raw.assetHub.getTypedApi(paseo_asset_hub),
        bulletin: raw.bulletin.getTypedApi(paseo_bulletin),
        raw,
        descriptors: {
            assetHub: paseo_asset_hub,
            bulletin: paseo_bulletin,
        },
        destroy,
    };
}

async function runContractDeploy(opts: ContractDeployOpts): Promise<void> {
    const target = resolveContractDeployTarget(opts);
    const cfg = getChainConfig();
    const rootDir = resolve(process.cwd());
    const features = resolveFeatures(opts.features, rootDir);

    let signer: ResolvedSigner | null = null;
    let client: ContractChainClient | null = null;
    const cleanupOnce = (() => {
        let ran = false;
        return () => {
            if (ran) return;
            ran = true;
            try {
                signer?.destroy();
            } catch {}
            try {
                client?.destroy();
            } catch {}
        };
    })();
    onProcessShutdown(cleanupOnce);

    try {
        signer = await resolveSigner(resolveContractSignerOptions(opts));
        await ensureSmartContractAllowance({
            env: cfg.env,
            ownerAddress: signer.address,
            deploySigner: signer,
        });
        client = await createContractChainClient(target);
        const metadataSigner = await getBulletinAllowanceSigner({
            env: cfg.env,
            ownerAddress: signer.address,
            publishSigner: signer,
            bulletinApi: client.bulletin,
        });

        const result = await runContractDeployWithUI({
            rootDir,
            features,
            client,
            signer: signer.signer,
            origin: signer.address as SS58String,
            registryAddress: target.registryAddress,
            metadataSigner,
            assethubUrl: target.assethubUrl,
            bulletinUrl: target.bulletinUrl,
            ipfsGatewayUrl: cfg.bulletinGateway,
            signerAddress: signer.address,
            signerRequiresApproval: signer.source === "session",
        });
        if (!result.success) process.exitCode = 1;
    } finally {
        cleanupOnce();
    }
}

function makeDeployCommand(): Command {
    return new Command("deploy")
        .description("Build, deploy, and register CDM contracts with the dot signer")
        .addOption(new Option("--signer <mode>", "Signer mode").choices(["dev", "phone"]))
        .option("--assethub-url <url>", "Override the Asset Hub WebSocket URL")
        .option("--bulletin-url <url>", "Override the Bulletin WebSocket URL")
        .option("--registry-address <address>", "Registry contract address")
        .option(
            "--suri <suri>",
            "Secret URI for local signing; defaults to bulletin-deploy's dev mnemonic when --signer dev",
        )
        .option("--features <features>", "Cargo feature flags to pass to the build")
        .action(async (opts: ContractDeployOpts) =>
            runCliCommand("contract", { watchdog: true, hardExit: true }, () =>
                runContractDeploy(opts),
            ),
        );
}

function makeInstallCommand(): Command {
    return new Command("install")
        .alias("i")
        .description("Install CDM contract libraries to ~/.cdm/")
        .argument(
            "[libraries...]",
            'CDM libraries (e.g., "@polkadot/reputation" or "@polkadot/reputation:3"). Omit to install all from cdm.json.',
        )
        .option("--assethub-url <url>", "WebSocket URL for Asset Hub chain")
        .option("-n, --name <name>", "Chain preset name (polkadot, paseo, preview-net, local)")
        .option("--ipfs-gateway-url <url>", "IPFS gateway URL for fetching metadata")
        .option("--registry-address <address>", "Registry contract address")
        .action(async (_libraries: string[], _opts: ContractInstallOpts) =>
            runCliCommand("contract", { watchdog: true, hardExit: true }, () =>
                runCdmSubprocess("install", cdmPassthroughArgs(process.argv, "install", ["i"])),
            ),
        );
}

export const contractCommand = new Command("contract")
    .description("Run CDM contract workflows")
    .addCommand(makeDeployCommand())
    .addCommand(makeInstallCommand());
