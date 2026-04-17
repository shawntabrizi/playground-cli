/**
 * Wrapper around `bulletin-deploy`'s `deploy()` that:
 *   - forces `jsMerkle: true` so we never shell out to Kubo (WebContainer-safe),
 *   - intercepts bulletin-deploy's `console.log` stream and turns it into
 *     typed progress events for the TUI,
 *   - surfaces bulletin-deploy's returned artifact IDs unchanged.
 *
 * All retry, nonce recovery, pool authorization, and DAG-PB verification
 * stays inside bulletin-deploy — we do not reimplement any of it here.
 */

import {
    deploy as bulletinDeploy,
    type DeployContent,
    type DeployOptions,
    type DeployResult,
} from "bulletin-deploy";
import { DeployLogParser, type DeployLogEvent } from "./progress.js";
import { getChainConfig, type Env } from "../../config.js";

export interface StorageDeployOptions {
    /**
     * What to upload — a filesystem path (file or directory) or raw bytes.
     * Matches bulletin-deploy's `DeployContent` type.
     */
    content: DeployContent;
    /**
     * DotNS domain name (without `.dot`) or `null` to skip DotNS registration
     * (used for the metadata JSON upload in the playground flow).
     */
    domainName: string | null;
    /**
     * Auth options forwarded to bulletin-deploy. Usually produced by
     * `resolveSignerSetup()`. May be `{}` for the dev path.
     */
    auth: Pick<DeployOptions, "signer" | "signerAddress" | "mnemonic">;
    /** Emits progress events derived from bulletin-deploy's log output. */
    onLogEvent?: (event: DeployLogEvent) => void;
    /** Target environment — currently only `testnet` is supported. */
    env?: Env;
    /**
     * Extra telemetry attributes merged into bulletin-deploy's deploy span.
     * Defaults to `{ "deploy.source": "playground-cli" }`.
     */
    attributes?: Record<string, string>;
}

export async function runStorageDeploy(options: StorageDeployOptions): Promise<DeployResult> {
    const cfg = getChainConfig(options.env);
    const parser = new DeployLogParser();
    const restore = interceptConsoleLog(options.onLogEvent, parser);

    try {
        return await bulletinDeploy(options.content, options.domainName, {
            // Intentionally NOT setting `jsMerkle: true` — bulletin-deploy's
            // pure-JS merkleizer (`merkleizeJS`) produces CARs that are
            // missing their DAG-PB structural blocks (directory + file nodes)
            // because `blockstore-core/memory`'s `getAll()` iterator drops
            // them in the `rawLeaves: true` + `wrapWithDirectory: true` code
            // path. We verified this against a real deployed CAR: 157 blocks,
            // zero DAG-PB, declared root not in the blocks — polkadot-desktop
            // parses zero files.
            //
            // Falling back to the Kubo binary path (default) produces a
            // complete, parseable CAR. `dot init` installs `ipfs` so the
            // binary is present on any machine that finished setup.
            //
            // Revisit when bulletin-deploy's `merkleizeJS` is fixed upstream
            // — then flip `jsMerkle: true` back on for the WebContainer (RevX)
            // story. See `src/utils/deploy/playground.ts` for an ongoing
            // WebContainer-safe path for metadata upload.
            rpc: cfg.bulletinRpc,
            ...options.auth,
            attributes: {
                "deploy.source": "playground-cli",
                ...options.attributes,
            },
        });
    } finally {
        restore();
    }
}

/**
 * Replace `console.log` / `console.error` / `console.warn` with a shim that
 * feeds each line into the progress parser. Returns a `restore()` that puts
 * the originals back — always call it from a `finally` block.
 *
 * We silence the direct prints because the TUI renders its own view derived
 * from the parsed events. If there is no `onLogEvent` sink we still parse
 * but emit nothing, so pool/DotNS log noise doesn't leak into the Ink render.
 */
function interceptConsoleLog(
    onEvent: ((event: DeployLogEvent) => void) | undefined,
    parser: DeployLogParser,
): () => void {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const feed = (parts: unknown[]) => {
        const combined = parts.map((p) => (typeof p === "string" ? p : String(p))).join(" ");
        for (const line of combined.split("\n")) {
            const event = parser.feed(line);
            if (event && onEvent) onEvent(event);
        }
    };

    console.log = (...args: unknown[]) => feed(args);
    console.warn = (...args: unknown[]) => feed(args);
    // bulletin-deploy only prints errors on the sad path; keep them visible on
    // stderr so diagnostics don't disappear if something unexpected happens.
    console.error = (...args: unknown[]) => {
        feed(args);
        originalError.apply(console, args as Parameters<typeof console.error>);
    };

    return () => {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    };
}
