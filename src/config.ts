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

/**
 * Single source of truth for environment-dependent values: RPC endpoints,
 * contract addresses, dapp identifiers, and feature defaults.
 *
 * Env IDs mirror bulletin-deploy's `assets/environments.json` (paseo-next,
 * paseo-next-v2, paseo-review, preview, polkadot, kusama) so a single value
 * threads through both layers. paseo-next-v2 is the only env fully wired
 * today; others throw from `getChainConfig` until they're populated.
 */

export type Env =
    | "preview"
    | "paseo-next"
    | "paseo-review"
    | "paseo-next-v2"
    | "polkadot"
    | "kusama";

export const ACTIVE_TESTNET_ENV: Env = "paseo-next-v2";
export const DEFAULT_ENV: Env = ACTIVE_TESTNET_ENV;

export interface ChainConfig {
    /** Env identifier — passes straight through to bulletin-deploy's `deploy({ env })`. */
    env: Env;
    /** Underlying network (testnet/mainnet) for cosmetics + gates. */
    network: "testnet" | "mainnet";
    /** Relay chain RPC (mostly informational; product-sdk talks to system chains directly). */
    relayRpc: string;
    /** Asset Hub RPC — Revive contracts (registry, DotNS) live here. */
    assetHubRpc: string;
    /** Primary Bulletin RPC for storage. */
    bulletinRpc: string;
    /**
     * Ordered fallback Bulletin endpoints. Always excludes `bulletinRpc`.
     * Used by callers that build their own WS provider (e.g. the dedicated
     * metadata-upload client in `src/utils/deploy/playground.ts`).
     * Typically empty; populated when `DOT_BULLETIN_RPC` overrides primary.
     */
    bulletinRpcFallbacks: string[];
    /** People chain endpoints (SSO / session discovery). */
    peopleEndpoints: string[];
    /** HTTP IPFS gateway for Bulletin content reads. */
    bulletinGateway: string;
    /** Identity backend (inviter/attestation/proxy lookup, allowance metadata). */
    identityBackendUrl: string;
    /** Viewer URL shown to users after a successful deploy. */
    appViewerOrigin: string;
    /** True when Revive auto-maps SS58 → H160 on first tx (paseo-next-v2 onward). */
    autoAccountMapping: boolean;
    /** True when `authorize_account` takes the v2 `{who, transactions, bytes}` signature. */
    bulletinAuthorizeV2: boolean;
    /** Public faucet URL, or null when allowances replace the funder flow. */
    faucetUrl: string | null;
}

// Paseo Next v2 — the active env. DotNS contracts are owned by
// bulletin-deploy's environment catalog and keyed by `env`.
const PASEO_NEXT_V2: ChainConfig = {
    env: "paseo-next-v2",
    network: "testnet",
    relayRpc: "wss://paseo-rpc.n.dwellir.com",
    assetHubRpc: "wss://paseo-asset-hub-next-rpc.polkadot.io",
    bulletinRpc: "wss://paseo-bulletin-next-rpc.polkadot.io",
    bulletinRpcFallbacks: [],
    peopleEndpoints: ["wss://paseo-people-next-system-rpc.polkadot.io"],
    bulletinGateway: "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs/",
    identityBackendUrl: "https://identity-backend-next.parity-testnet.parity.io",
    appViewerOrigin: "https://dot.li",
    autoAccountMapping: true,
    bulletinAuthorizeV2: true,
    faucetUrl: null,
};

const CONFIGS: Partial<Record<Env, ChainConfig>> = {
    "paseo-next-v2": PASEO_NEXT_V2,
    // Other envs are not wired yet — getChainConfig() throws below.
};

export function getChainConfig(env: Env = DEFAULT_ENV): ChainConfig {
    const cfg = CONFIGS[env];
    if (!cfg) {
        throw new Error(
            `--env ${env} is not yet supported. Use --env paseo-next-v2 (default). ` +
                `Supported envs in this build: ${Object.keys(CONFIGS).join(", ")}`,
        );
    }
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
            bulletinRpcFallbacks: [cfg.bulletinRpc, ...cfg.bulletinRpcFallbacks],
        };
    }
    return cfg;
}

/**
 * Map legacy `--env testnet|mainnet` flag values onto the new env IDs.
 * Keeps existing scripts/CI working while we transition.
 */
export function resolveLegacyEnv(input: string): Env {
    if (input === "testnet") return ACTIVE_TESTNET_ENV;
    if (input === "mainnet") return "polkadot";
    return input as Env;
}

/**
 * Human-readable network label for the Header bread-crumb. Lower-cased to
 * match the existing visual style ("paseo", "polkadot").
 */
export function getNetworkLabel(env: Env = DEFAULT_ENV): string {
    switch (env) {
        case "paseo-next-v2":
            return "paseo next v2";
        case "paseo-next":
            return "paseo next";
        case "paseo-review":
            return "paseo review";
        case "preview":
            return "preview";
        case "polkadot":
            return "polkadot";
        case "kusama":
            return "kusama";
    }
}

/** Identifier the terminal adapter reports during SSO. Kept stable so mobile pairings persist across releases. */
export const DAPP_ID = "dot-cli";

/**
 * Product account identifier used for mobile signing. Must match the
 * `dotNsIdentifier` the deployed playground-app passes to
 * `HostProvider.getProductAccount(...)` (see
 * `playground-app/src/config.ts::defaultDotNsId`) so that the CLI and the
 * playground-app resolve to the EXACT SAME product-derived account on the
 * user's wallet. The mobile derives the product keypair via
 * `mnemonic + "/product/{PLAYGROUND_PRODUCT_ID}/0"`; changing this value
 * changes the on-chain account.
 */
export const PLAYGROUND_PRODUCT_ID = "playground.dot";

/** Default build output directory — matches Vite and the interactive prompt default. */
export const DEFAULT_BUILD_DIR = "dist";
