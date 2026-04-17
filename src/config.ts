/**
 * Single source of truth for environment-dependent values: RPC endpoints,
 * contract addresses, dapp identifiers, and feature defaults.
 *
 * When mainnet launches we will add a second profile here and thread an
 * `env` value through the commands. Until then only `testnet` is supported
 * and every consumer should import from this module rather than inlining
 * URLs or addresses elsewhere.
 */

export type Env = "testnet" | "mainnet";

export const DEFAULT_ENV: Env = "testnet";

export interface ChainConfig {
    /** WebSocket endpoint for Paseo Asset Hub (Revive contracts live here). */
    assetHubRpc: string;
    /** WebSocket endpoint for Paseo Bulletin (immutable IPFS storage). */
    bulletinRpc: string;
    /** WebSocket endpoints for the People chain (SSO / session discovery). */
    peopleEndpoints: string[];
    /** Playground registry contract on Asset Hub. Backing store for myApps. */
    playgroundRegistryAddress: `0x${string}`;
    /** Viewer URL shown to users after a successful deploy. */
    appViewerOrigin: string;
}

const TESTNET: ChainConfig = {
    assetHubRpc: "wss://asset-hub-paseo-rpc.n.dwellir.com",
    bulletinRpc: "wss://paseo-bulletin-rpc.polkadot.io",
    peopleEndpoints: ["wss://paseo-people-next-rpc.polkadot.io"],
    playgroundRegistryAddress: "0x279585Cb8E8971e34520A3ebbda3E0C4D77C3d97",
    appViewerOrigin: "https://dot.li",
};

export function getChainConfig(env: Env = DEFAULT_ENV): ChainConfig {
    if (env === "mainnet") {
        throw new Error(
            "`--env mainnet` is not yet supported. Use `--env testnet` (default) while mainnet launch is pending.",
        );
    }
    return TESTNET;
}

/** Identifier the terminal adapter reports during SSO. Kept stable so mobile pairings persist across releases. */
export const DAPP_ID = "dot-cli";

/**
 * Runtime metadata the terminal adapter fetches to render transactions on the
 * mobile wallet. Hosted on a gist today; intentionally a URL rather than a
 * pinned file so it can be rotated without a CLI release.
 */
export const TERMINAL_METADATA_URL =
    "https://gist.githubusercontent.com/ReinhardHatko/1967dd3f4afe78683cc0ba14d6ec8744/raw/c1625eb7ed7671b7e09a3fa2a25998dde33c70b8/metadata.json";

/** Default build output directory — matches Vite and the interactive prompt default. */
export const DEFAULT_BUILD_DIR = "dist";
