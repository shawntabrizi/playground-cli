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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateContractTypes, generateContractsAugmentation } from "@parity/cdm-codegen";
import {
    CONTRACTS_REGISTRY_ABI,
    generateSolidityImport,
    hasBuildableSolidityProject,
    readCdmJson,
    resolveFeatures,
    type CdmJson,
    type InstallLibraryRequest,
    type InstallResult,
    type PipelineChainClient,
    type SolidityAbiEntry,
    writeCdmJson,
} from "@parity/cdm-builder";
import {
    connectIpfsGateway,
    createCdmAssetHubClient,
    getChainPreset,
    getRegistryAddress,
} from "@parity/cdm-env";
import type { CloudStorageApi } from "@parity/product-sdk-cloud-storage";
import { createContractFromClient } from "@parity/product-sdk-contracts";
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
import { BULLETIN_WS_HEARTBEAT_MS } from "../utils/bulletinWs.js";
import { suppressReviveTraceNoise } from "../utils/contractManifest.js";
import type { SignerMode } from "../utils/deploy/signerMode.js";
import { onProcessShutdown } from "../utils/process-guard.js";
import { resolveSigner, type ResolvedSigner, type SignerOptions } from "../utils/signer.js";
import { runContractDeployWithUI } from "./contractDeployUi.js";
import { runContractInstallWithUI } from "./contractInstallUi.js";

const CDM_INCLUDE = ".cdm/**/*";
// CDM registry getters are read-only, but Revive dry-run queries still require
// an origin that encodes on the target chain. This value is not a signer.
const REGISTRY_QUERY_ORIGIN_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

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

interface ContractInstallTarget {
    assethubUrl: string;
    ipfsGatewayUrl: string;
    registryAddress: HexString;
    chainName?: string;
}

type ContractChainClient = PipelineChainClient & { destroy(): void };

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

export function parseContractInstallLibraryArg(arg: string): InstallLibraryRequest {
    const colonIdx = arg.lastIndexOf(":");
    if (colonIdx > 0) {
        const library = arg.slice(0, colonIdx);
        const version = Number.parseInt(arg.slice(colonIdx + 1), 10);
        if (!Number.isNaN(version)) return { library, requestedVersion: version };
    }
    return { library: arg, requestedVersion: "latest" };
}

export function resolveContractInstallTarget(
    opts: ContractInstallOpts,
    cdmJson?: CdmJson,
): ContractInstallTarget {
    const cfg = getChainConfig();
    let assethubUrl = opts.assethubUrl;
    let ipfsGatewayUrl = opts.ipfsGatewayUrl;
    let registryAddress = opts.registryAddress;
    const chainName = opts.name;

    if (opts.name && opts.name !== "custom") {
        const preset = getChainPreset(opts.name);
        assethubUrl ??= preset.assethubUrl;
        ipfsGatewayUrl ??= preset.ipfsGatewayUrl;
        registryAddress ??= preset.registryAddress;
    }

    registryAddress ??= cdmJson?.registry;
    assethubUrl ??= cfg.assetHubRpc;
    ipfsGatewayUrl ??= cfg.bulletinGateway;
    registryAddress ??= getRegistryAddress(cfg.env);

    return {
        assethubUrl,
        ipfsGatewayUrl,
        registryAddress: assertHexAddress(registryAddress, "Registry address"),
        chainName: chainName === "custom" ? undefined : chainName,
    };
}

async function createContractChainClient(
    target: ContractDeployTarget,
): Promise<ContractChainClient> {
    const raw = {
        assetHub: createClient(getWsProvider([target.assethubUrl])),
        bulletin: createClient(
            getWsProvider(target.bulletinUrls, { heartbeatTimeout: BULLETIN_WS_HEARTBEAT_MS }),
        ),
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
            deploySigner: signer,
        });
        client = await createContractChainClient(target);
        const metadataSigner = await getBulletinAllowanceSigner({
            publishSigner: signer,
            // client.bulletin is the same runtime bulletin API, but it's nominally
            // typed as @parity/cdm-env's CdmBulletinApi (built against an older
            // product-sdk-cloud-storage than the CLI's). Bridge the version skew.
            bulletinApi: client.bulletin as unknown as CloudStorageApi,
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

function detectProjectType(rootDir: string): {
    hasRust: boolean;
    hasSolidity: boolean;
    hasTypeScript: boolean;
} {
    return {
        hasRust: existsSync(resolve(rootDir, "Cargo.toml")),
        hasSolidity: hasBuildableSolidityProject(rootDir),
        hasTypeScript: existsSync(resolve(rootDir, "package.json")),
    };
}

function installRequestsFromArgs(libraries: string[], cdmJson: CdmJson): InstallLibraryRequest[] {
    if (libraries.length > 0) return libraries.map(parseContractInstallLibraryArg);

    const deps = cdmJson.dependencies;
    if (!deps || Object.keys(deps).length === 0) {
        throw new Error("No library specified and no dependencies found in cdm.json.");
    }

    return Object.entries(deps).map(([library, version]) => ({
        library,
        requestedVersion: version === "latest" ? "latest" : Number(version),
    }));
}

function updateCdmJsonAfterInstall(
    cdmJson: CdmJson,
    target: ContractInstallTarget,
    requests: InstallLibraryRequest[],
    results: InstallResult[],
): void {
    cdmJson.registry = target.registryAddress;
    cdmJson.dependencies ??= {};
    cdmJson.contracts ??= {};

    for (const result of results) {
        const request = requests.find((entry) => entry.library === result.library);
        if (!request) continue;
        cdmJson.dependencies[result.library] = request.requestedVersion;
        cdmJson.contracts[result.library] = {
            version: result.version,
            address: result.address,
            abi: result.abi,
            metadataCid: result.metadataCid,
        };
    }
}

function ensureTsconfigIncludesCdm(rootDir: string): void {
    const tsconfigPath = resolve(rootDir, "tsconfig.json");

    let tsconfig: Record<string, unknown>;
    if (existsSync(tsconfigPath)) {
        try {
            tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
        } catch {
            return;
        }
    } else {
        tsconfig = {};
    }

    const include = Array.isArray(tsconfig.include) ? tsconfig.include : [];
    const alreadyHas = include.some(
        (entry: unknown) => typeof entry === "string" && entry.replace(/^\.\//, "") === CDM_INCLUDE,
    );
    if (alreadyHas) return;

    include.push(`./${CDM_INCLUDE}`);
    tsconfig.include = include;
    writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 4)}\n`);
}

function postInstallSolidity(rootDir: string, cdmJson: CdmJson): void {
    const contractsForTarget = cdmJson.contracts;
    if (!contractsForTarget) return;

    for (const [library, data] of Object.entries(contractsForTarget)) {
        const generated = generateSolidityImport({
            library,
            address: data.address,
            version: data.version,
            abi: data.abi as SolidityAbiEntry[],
        });
        const outputPath = resolve(rootDir, generated.path);
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, generated.content);
    }
}

function postInstallTypeScript(rootDir: string, cdmJson: CdmJson): void {
    const contractsForTarget = cdmJson.contracts;
    if (!contractsForTarget) return;

    const contracts = Object.entries(contractsForTarget).map(([library, data]) => ({
        library,
        abi: data.abi as Parameters<typeof generateContractTypes>[0][number]["abi"],
    }));
    if (contracts.length === 0) return;

    const cdmDir = resolve(rootDir, ".cdm");
    mkdirSync(cdmDir, { recursive: true });
    writeFileSync(resolve(cdmDir, "cdm.d.ts"), generateContractTypes(contracts));
    writeFileSync(resolve(cdmDir, "contracts.d.ts"), generateContractsAugmentation(contracts));
    ensureTsconfigIncludesCdm(rootDir);
}

function runPostInstallHooks(rootDir: string, cdmJson: CdmJson): void {
    const projectType = detectProjectType(rootDir);
    if (projectType.hasSolidity) postInstallSolidity(rootDir, cdmJson);
    if (projectType.hasTypeScript) postInstallTypeScript(rootDir, cdmJson);
}

async function runContractInstall(libraries: string[], opts: ContractInstallOpts): Promise<void> {
    const rootDir = resolve(process.cwd());
    const cdmResult = readCdmJson(rootDir);
    const cdmJson = cdmResult?.cdmJson ?? { dependencies: {}, contracts: {} };
    const target = resolveContractInstallTarget(opts, cdmJson);
    const requests = installRequestsFromArgs(libraries, cdmJson);

    let client: Awaited<ReturnType<typeof createCdmAssetHubClient>> | null = null;
    const cleanupOnce = (() => {
        let ran = false;
        return () => {
            if (ran) return;
            ran = true;
            try {
                client?.destroy();
            } catch {}
        };
    })();
    onProcessShutdown(cleanupOnce);

    try {
        client = await createCdmAssetHubClient(target.assethubUrl, target.chainName);
        await client.raw.assetHub.getChainSpecData();
        // Registry getters run through Revive dry-run queries, so product-sdk
        // still needs a mapped origin to encode the call. This is not a signer.
        const registry = suppressReviveTraceNoise(
            await createContractFromClient(
                client.raw.assetHub,
                client.descriptors.assetHub,
                target.registryAddress,
                CONTRACTS_REGISTRY_ABI,
                { defaultOrigin: REGISTRY_QUERY_ORIGIN_SS58 },
            ),
        );
        const ipfs = connectIpfsGateway(target.ipfsGatewayUrl);

        const result = await runContractInstallWithUI({
            libraries: requests,
            registry,
            ipfs,
            registryAddress: target.registryAddress,
            assethubUrl: target.assethubUrl,
            ipfsGatewayUrl: target.ipfsGatewayUrl,
        });

        updateCdmJsonAfterInstall(cdmJson, target, requests, result.summary.results);
        writeCdmJson(cdmJson, rootDir);
        if (result.summary.results.length > 0) {
            runPostInstallHooks(rootDir, cdmJson);
        }
        if (!result.success) process.exitCode = 1;
    } finally {
        cleanupOnce();
    }
}

function makeDeployCommand(): Command {
    return new Command("deploy")
        .description("Build, deploy, and register CDM contracts with the logged-in signer")
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
        .action(async (libraries: string[], opts: ContractInstallOpts) =>
            runCliCommand("contract", { watchdog: true, hardExit: true }, () =>
                runContractInstall(libraries, opts),
            ),
        );
}

export const contractCommand = new Command("contract")
    .description("Run CDM contract workflows")
    .addCommand(makeDeployCommand())
    .addCommand(makeInstallCommand());
