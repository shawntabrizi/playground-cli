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
    /**
     * Ordered fallback endpoints for Bulletin, used where the caller builds its
     * own WS provider (e.g. the dedicated metadata-upload client in
     * `src/utils/deploy/playground.ts`). Always excludes `bulletinRpc` itself.
     * Typically empty; populated when `DOT_BULLETIN_RPC` overrides the primary.
     */
    bulletinRpcFallbacks: string[];
    /** WebSocket endpoints for the People chain (SSO / session discovery). */
    peopleEndpoints: string[];
    /** Viewer URL shown to users after a successful deploy. */
    appViewerOrigin: string;
}

const TESTNET: ChainConfig = {
    assetHubRpc: "wss://asset-hub-paseo-rpc.n.dwellir.com",
    bulletinRpc: "wss://paseo-bulletin-rpc.polkadot.io",
    bulletinRpcFallbacks: [],
    peopleEndpoints: ["wss://paseo-people-next-rpc.polkadot.io"],
    appViewerOrigin: "https://dot.li",
};

export function getChainConfig(env: Env = DEFAULT_ENV): ChainConfig {
    if (env === "mainnet") {
        throw new Error(
            "`--env mainnet` is not yet supported. Use `--env testnet` (default) while mainnet launch is pending.",
        );
    }
    const cfg = TESTNET;
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

/** Fixed CDM meta-registry contract on Asset Hub. Source: @dotdm/utils REGISTRY_ADDRESS. */
export const CDM_REGISTRY_ADDRESS = "0xae344f7f0f91d3a2176032af2990abcc7606c7d4";

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
