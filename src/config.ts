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

import type { CdmJson } from "@parity/product-sdk-contracts";
import cdmJson from "../cdm.json";
import { defaultCdmTarget } from "./utils/cdmTarget.js";

/**
 * Single source of truth for environment-dependent values: RPC endpoints,
 * contract addresses, dapp identifiers, and feature defaults.
 *
 * `ACTIVE_TESTNET_NETWORK` is the single testnet switch. Endpoints, UI labels,
 * descriptor selection, and CDM-derived values should flow from this module
 * instead of being inlined elsewhere. When mainnet launches we will add a
 * second profile here and thread an `env` value through the commands.
 */

export type Env = "testnet" | "mainnet";
export type TestnetNetwork = "preview-net" | "paseo";

export const DEFAULT_ENV: Env = "testnet";
export const ACTIVE_TESTNET_NETWORK = "preview-net" satisfies TestnetNetwork;

const CDM_TARGET = defaultCdmTarget(cdmJson as unknown as CdmJson);

function requiredCdmEndpoint(name: "asset-hub" | "bulletin"): string {
    const value = CDM_TARGET[name];
    if (!value) throw new Error(`cdm.json target is missing ${name} endpoint`);
    return value;
}

function ensureTrailingSlash(value: string): string {
    return value.endsWith("/") ? value : `${value}/`;
}

export interface ChainConfig {
    /** Human-readable network label for headers and diagnostics. */
    networkLabel: TestnetNetwork;
    /** WebSocket endpoint for the CDM target Asset Hub (Revive contracts live here). */
    assetHubRpc: string;
    /** WebSocket endpoint for Bulletin (immutable IPFS storage). */
    bulletinRpc: string;
    /**
     * Ordered fallback endpoints for Bulletin, used where the caller builds its
     * own WS provider (e.g. the dedicated metadata-upload client in
     * `src/utils/deploy/playground.ts`). Always excludes `bulletinRpc` itself.
     * Typically empty; populated when `DOT_BULLETIN_RPC` overrides the primary.
     */
    bulletinRpcFallbacks: string[];
    /** WebSocket endpoints for the People chain (SSO / session discovery). */
    peopleEndpoints: string[];
    /** HTTP IPFS gateway for Bulletin content reads. */
    bulletinGateway: string;
    /** Viewer URL shown to users after a successful deploy. */
    appViewerOrigin: string;
    /** Faucet URL shown when testnet funding helpers cannot top up an account. */
    faucetUrl: string;
}

const TESTNET_NETWORKS: Record<TestnetNetwork, ChainConfig> = {
    "preview-net": {
        networkLabel: "preview-net",
        assetHubRpc: requiredCdmEndpoint("asset-hub"),
        bulletinRpc: "wss://previewnet.substrate.dev/bulletin",
        bulletinRpcFallbacks: [],
        peopleEndpoints: ["wss://previewnet.substrate.dev/people"],
        bulletinGateway: ensureTrailingSlash(requiredCdmEndpoint("bulletin")),
        appViewerOrigin: "https://dot.li",
        faucetUrl: "https://faucet.polkadot.io/?network=pah",
    },
    paseo: {
        networkLabel: "paseo",
        assetHubRpc: "wss://asset-hub-paseo-rpc.n.dwellir.com",
        bulletinRpc: "wss://paseo-bulletin-rpc.polkadot.io",
        bulletinRpcFallbacks: [],
        peopleEndpoints: ["wss://paseo-people-next-rpc.polkadot.io"],
        bulletinGateway: "https://paseo-ipfs.polkadot.io/ipfs/",
        appViewerOrigin: "https://dot.li",
        faucetUrl: "https://faucet.polkadot.io/?network=pah",
    },
};

export function getChainConfig(env: Env = DEFAULT_ENV): ChainConfig {
    if (env === "mainnet") {
        throw new Error(
            "`--env mainnet` is not yet supported. Use `--env testnet` (default) while mainnet launch is pending.",
        );
    }
    const cfg = TESTNET_NETWORKS[ACTIVE_TESTNET_NETWORK];
    // CHAOS-test hook: when DOT_BULLETIN_RPC is set, use it as the primary
    // Bulletin endpoint and retain the built-in URL as a fallback so failover
    // works. bulletin-deploy's deploy() already applies this pattern internally
    // (it builds [userRpc, DEFAULT] from options.rpc), so storage.ts consumers
    // get failover for free. The dedicated WS client in playground.ts reads
    // bulletinRpcFallbacks explicitly and builds its own endpoint array.
    // Used by `e2e/cli/chaos.test.ts` to simulate an unreachable primary RPC.
    const override = process.env.DOT_BULLETIN_RPC;
    if (override) {
        return {
            ...cfg,
            bulletinRpc: override,
            bulletinRpcFallbacks: [cfg.bulletinRpc],
        };
    }
    return cfg;
}

export function getNetworkLabel(env: Env = DEFAULT_ENV): string {
    return getChainConfig(env).networkLabel;
}

/** Identifier the terminal adapter reports during SSO. Kept stable so mobile pairings persist across releases. */
export const DAPP_ID = "dot-cli";

/** Product account identifier used for mobile signing. Matches playground.dot's host product id. */
export const PLAYGROUND_PRODUCT_ID = "playground.dot";

/**
 * Runtime metadata the terminal adapter fetches to render transactions on the
 * mobile wallet. Hosted on a gist today; intentionally a URL rather than a
 * pinned file so it can be rotated without a CLI release.
 */
export const TERMINAL_METADATA_URL =
    "https://gist.githubusercontent.com/ReinhardHatko/1967dd3f4afe78683cc0ba14d6ec8744/raw/c1625eb7ed7671b7e09a3fa2a25998dde33c70b8/metadata.json";

/** Default build output directory — matches Vite and the interactive prompt default. */
export const DEFAULT_BUILD_DIR = "dist";
