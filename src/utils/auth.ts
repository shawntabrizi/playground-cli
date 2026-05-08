/**
 * QR login flow — pure business logic, no UI.
 *
 * Flow:
 *   1. `connect()` — starts adapter + auth, returns existing address OR QR code
 *   2. Print QR code to stdout (if needed) — before Ink mounts
 *   3. `waitForLogin()` — awaits the already-running auth to complete
 *   4. `getSessionSigner()` — gets a working signer for tx signing (separate adapter)
 *   5. `findSession()` / `waitForLogout()` — sign out flow, mirror image of connect/waitForLogin
 */

import type { Dirent } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ss58Encode } from "@parity/product-sdk-address";
import {
    createTerminalAdapter,
    waitForSessions,
    renderQrCode,
    type TerminalAdapter,
    type PairingStatus,
    type AttestationStatus,
    type UserSession,
} from "@parity/product-sdk-terminal";
import { getPolkadotSignerFromPjs } from "polkadot-api/pjs-signer";
import type { PolkadotSigner } from "polkadot-api";
import {
    DAPP_ID,
    PLAYGROUND_PRODUCT_ID,
    TERMINAL_METADATA_URL,
    getChainConfig,
} from "../config.js";

/** How long we wait for the statement store to publish the pairing QR. */
const QR_TIMEOUT_MS = 60_000;

function createAdapter(): TerminalAdapter {
    return createTerminalAdapter({
        appId: DAPP_ID,
        metadataUrl: TERMINAL_METADATA_URL,
        endpoints: getChainConfig().peopleEndpoints,
    });
}

/**
 * Local replacement for `@parity/product-sdk-terminal::createSessionSignerForAccount`.
 *
 * The published `@parity/product-sdk-terminal@0.1.0` routes BOTH transaction
 * signing and arbitrary-byte signing through `session.signRaw`, which the
 * mobile wallet wraps with `<Bytes>...</Bytes>` (the anti-phishing envelope —
 * see `polkadot-app-android-v2/.../MessageSigningContext.kt::generalUntrustedMessage`).
 * The chain rejects the resulting signature with `BadProof` because the
 * signature is over `<Bytes>${payload}</Bytes>` rather than `${payload}`.
 *
 * Upstream fix landed on `paritytech/product-sdk` `main` as commit `a33edf3`
 * ("fix(terminal): route signTx through session.signPayload to avoid BadProof",
 * PR #62) but is NOT yet on npm — the registry-latest is still `0.1.0`. Until
 * a version with that fix ships, we mirror its approach here: PAPI's PJS
 * signer interface lets us provide separate `signPayload` and `signRaw`
 * callbacks, so transaction signing can route through `session.signPayload`
 * (mobile's `SignPayloadJsonInteractor` — chain-tx context, no `<Bytes>` wrap)
 * while arbitrary-byte signing keeps using `session.signRaw` (mobile's
 * `SignRawInteractor` — `<Bytes>` wrap, correct for arbitrary user data).
 *
 * REMOVE this helper and switch back to `createSessionSignerForAccount` once
 * the npm dist-tag for `@parity/product-sdk-terminal` reflects `a33edf3`.
 */
function createPlaygroundSigner(session: UserSession): PolkadotSigner {
    const productAccountId: [string, number] = [PLAYGROUND_PRODUCT_ID, 0];
    const accountId = new Uint8Array(session.remoteAccount.accountId);
    const accountIdHex = asHex(toHex(accountId));
    return getPolkadotSignerFromPjs(
        accountIdHex,
        makeSignPayloadCallback(session, productAccountId),
        makeSignRawCallback(session, productAccountId),
    );
}

function asHex(v: string): `0x${string}` {
    return v.startsWith("0x") ? (v as `0x${string}`) : (`0x${v}` as `0x${string}`);
}

function toHex(bytes: Uint8Array): `0x${string}` {
    return `0x${Buffer.from(bytes).toString("hex")}` as `0x${string}`;
}

function fromHex(hex: string): Uint8Array {
    const stripped = hex.startsWith("0x") ? hex.slice(2) : hex;
    return new Uint8Array(Buffer.from(stripped, "hex"));
}

// Minimal local PJS payload types — `@polkadot-api/pjs-signer` exposes the
// canonical `SignerPayloadJSON` only as an internal type. Structurally
// matches the fields the mappers always emit; mirrors the shape the
// upstream `signer.ts` uses.
type PjsSignerPayloadJSON = {
    address: string;
    assetId?: number | object;
    blockHash: string;
    blockNumber: string;
    era: string;
    genesisHash: string;
    metadataHash?: string;
    method: string;
    mode?: number;
    nonce: string;
    specVersion: string;
    tip: string;
    transactionVersion: string;
    signedExtensions: string[];
    version: number;
    withSignedTransaction?: boolean;
};

type PjsSignRawPayload = {
    address: string;
    data: string;
    type: "bytes";
};

/**
 * Hook for transaction signing — translates PAPI's `SignerPayloadJSON` into
 * host-papp's `SigningPayloadRequest` and routes to `session.signPayload`.
 *
 * @internal Exported only for `auth.test.ts`'s BadProof regression guards;
 * not part of the public surface of this module.
 */
export function makeSignPayloadCallback(session: UserSession, productAccountId: [string, number]) {
    return async (
        payload: PjsSignerPayloadJSON,
    ): Promise<{
        signature: `0x${string}`;
        signedTransaction?: `0x${string}`;
    }> => {
        const result = await session.signPayload({
            productAccountId,
            blockHash: asHex(payload.blockHash),
            blockNumber: asHex(payload.blockNumber),
            era: asHex(payload.era),
            genesisHash: asHex(payload.genesisHash),
            method: asHex(payload.method),
            nonce: asHex(payload.nonce),
            specVersion: asHex(payload.specVersion),
            tip: asHex(payload.tip),
            transactionVersion: asHex(payload.transactionVersion),
            signedExtensions: payload.signedExtensions,
            version: payload.version,
            assetId:
                payload.assetId !== undefined
                    ? (payload.assetId as never as `0x${string}`)
                    : undefined,
            metadataHash: payload.metadataHash ? asHex(payload.metadataHash) : undefined,
            mode: payload.mode,
            withSignedTransaction: payload.withSignedTransaction,
        });
        if (result.isErr()) {
            throw new Error(`Mobile signing rejected: ${result.error.message}`);
        }
        return {
            signature: toHex(result.value.signature) as `0x${string}`,
            signedTransaction: result.value.signedTransaction
                ? (toHex(result.value.signedTransaction) as `0x${string}`)
                : undefined,
        };
    };
}

/**
 * Hook for arbitrary-byte signing — routes to `session.signRaw`. The mobile
 * applies the `<Bytes>...</Bytes>` envelope, which is correct for free-form
 * data but wrong for tx payloads (see {@link makeSignPayloadCallback}).
 *
 * @internal Exported only for `auth.test.ts`; not part of the public surface.
 */
export function makeSignRawCallback(session: UserSession, productAccountId: [string, number]) {
    return async (
        payload: PjsSignRawPayload,
    ): Promise<{
        id: number;
        signature: `0x${string}`;
    }> => {
        const result = await session.signRaw({
            productAccountId,
            data: { tag: "Bytes" as const, value: fromHex(payload.data) },
        });
        if (result.isErr()) {
            throw new Error(`Mobile signing rejected: ${result.error.message}`);
        }
        return {
            id: 0,
            signature: toHex(result.value.signature) as `0x${string}`,
        };
    };
}

function sessionSigningAddress(session: UserSession): string {
    return ss58Encode(createPlaygroundSigner(session).publicKey);
}

export type ConnectResult =
    | { kind: "existing"; address: string }
    | { kind: "qr"; qrCode: string; login: LoginHandle };

export type LoginStatus =
    | { step: "waiting" }
    | { step: "paired" }
    | { step: "attesting"; username: string }
    | { step: "success"; address: string }
    | { step: "error"; message: string };

export interface LoginHandle {
    adapter: TerminalAdapter;
    /** The authenticate() promise — already running since connect(). */
    authPromise: ReturnType<TerminalAdapter["sso"]["authenticate"]>;
}

/**
 * Connect to the statement store and resolve the login state.
 * Returns immediately if an existing session is found (address only).
 * Otherwise kicks off authenticate(), waits for the QR payload,
 * and returns the QR code + a handle to await the auth result.
 */
export async function connect(): Promise<ConnectResult> {
    const adapter = createAdapter();

    const sessions = await waitForSessions(adapter);
    if (sessions.length > 0) {
        return { kind: "existing", address: sessionSigningAddress(sessions[0]) };
    }

    // Start authenticate — this triggers the pairing flow and QR emission
    const authPromise = adapter.sso.authenticate();

    // Wait for the QR payload (with timeout)
    try {
        const qrCode = await Promise.race([
            new Promise<string>((resolve) => {
                let done = false;
                let unsub: (() => void) | undefined;
                unsub = adapter.sso.pairingStatus.subscribe(async (status: PairingStatus) => {
                    if (status.step === "pairing" && !done) {
                        done = true;
                        unsub?.();
                        resolve(await renderQrCode(status.payload));
                    }
                });
            }),
            new Promise<never>((_, reject) =>
                setTimeout(
                    () =>
                        reject(
                            new Error(
                                `Login service did not respond within ${Math.round(
                                    QR_TIMEOUT_MS / 1000,
                                )}s — try again`,
                            ),
                        ),
                    QR_TIMEOUT_MS,
                ),
            ),
        ]);

        return { kind: "qr", qrCode, login: { adapter, authPromise } };
    } catch (err) {
        // Release the WebSocket so we don't leak on the error path.
        try {
            adapter.destroy();
        } catch {
            // best-effort cleanup; ignore
        }
        throw err;
    }
}

/**
 * Wait for the already-running login to complete.
 * Call this after the QR code is displayed. Reports status via callback.
 * Returns the SS58 address on success, or null on failure.
 */
export async function waitForLogin(
    { adapter, authPromise }: LoginHandle,
    onStatus: (status: LoginStatus) => void,
): Promise<string | null> {
    onStatus({ step: "waiting" });

    const unsubPairing = adapter.sso.pairingStatus.subscribe((status: PairingStatus) => {
        if (status.step === "finished") {
            onStatus({ step: "paired" });
        } else if (status.step === "pairingError") {
            onStatus({ step: "error", message: status.message });
        }
    });

    const unsubAttestation = adapter.sso.attestationStatus.subscribe(
        (status: AttestationStatus) => {
            if (status.step === "attestation") {
                onStatus({ step: "attesting", username: status.username });
            } else if (status.step === "attestationError") {
                onStatus({ step: "error", message: status.message });
            }
        },
    );

    let authenticated = false;
    let address: string | null = null;
    try {
        const result = await authPromise;
        result.match(
            (session) => {
                if (session) {
                    authenticated = true;
                }
            },
            (error) => {
                onStatus({ step: "error", message: error.message });
            },
        );
        if (authenticated) {
            const sessions = await waitForSessions(adapter, 3000);
            if (sessions.length > 0) {
                address = sessionSigningAddress(sessions[0]);
                onStatus({ step: "success", address });
            } else {
                onStatus({
                    step: "error",
                    message: "Login succeeded but the local session was not available",
                });
            }
        }
    } finally {
        // Always clear subscriptions, even if authPromise rejects.
        unsubPairing();
        unsubAttestation();
    }

    return address;
}

/**
 * A session signer bundle — the signer plus an explicit `destroy()` that
 * tears down the long-lived adapter the signer depends on. Callers MUST
 * invoke `destroy()` once they're done (typically inside a `useEffect`
 * cleanup or `try/finally`) — the WebSocket keeps the event loop alive.
 */
export interface SessionHandle {
    address: string;
    signer: PolkadotSigner;
    destroy(): void;
}

/**
 * Get a working signer from a persisted session.
 *
 * The returned handle owns a terminal adapter that stays alive for as long
 * as the signer is in use (signing goes through the adapter's WebSocket).
 * Call `destroy()` on the handle when you're done — otherwise the event
 * loop will not exit on its own and you'll have to `process.exit()`.
 *
 * Returns null if no session exists (user hasn't logged in).
 */
export async function getSessionSigner(): Promise<SessionHandle | null> {
    const adapter = createAdapter();

    const sessions = await waitForSessions(adapter, 3000);
    if (sessions.length === 0) {
        adapter.destroy();
        return null;
    }

    const session = sessions[0];
    const signer = createPlaygroundSigner(session);
    const address = ss58Encode(signer.publicKey);

    let destroyed = false;
    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        try {
            adapter.destroy();
        } catch {
            // best-effort; adapter.destroy() is idempotent in practice
        }
    };

    return { address, signer, destroy };
}

// ── Sign-out flow ─────────────────────────────────────────────────────────────
//
// Mirror image of connect() + waitForLogin(). `findSession()` does the I/O to
// decide if there's anything to sign out of; `waitForLogout()` performs the
// disconnect and takes ownership of the adapter's `destroy()`.

export type LogoutStatus =
    | { step: "disconnecting"; address: string }
    | { step: "success"; address: string }
    | { step: "partial"; address: string; reason: string }
    | { step: "error"; message: string };

export interface LogoutHandle {
    adapter: TerminalAdapter;
    address: string;
    session: UserSession;
}

/**
 * Look up the currently paired session, if any.
 *
 * Returns a handle ready for `waitForLogout()`, or `null` when no session is
 * signed in. On the null path the adapter is destroyed here so callers don't
 * have to care.
 */
export async function findSession(): Promise<LogoutHandle | null> {
    const adapter = createAdapter();
    const sessions = await waitForSessions(adapter, 3000);
    if (sessions.length === 0) {
        adapter.destroy();
        return null;
    }
    const session = sessions[0];
    const address = sessionSigningAddress(session);
    return { adapter, address, session };
}

/**
 * Disconnect the given session. Reports progress via callback.
 *
 * Happy path: `adapter.sessions.disconnect()` sends a `Disconnected` statement
 * so the paired mobile app drops its side of the connection, then clears the
 * local session + user-secret files.
 *
 * If the remote notification fails (statement store unreachable, WebSocket
 * torn down, …) we fall back to deleting the `${DAPP_ID}_*` files in
 * `~/.polkadot-apps/` directly — strictly narrower than `rm -rf ~/.polkadot-apps`
 * and keeps the user unblocked. The mobile app will show a stale pairing
 * until it reconnects, which we surface via `partial`.
 *
 * Always releases the adapter before returning.
 */
export async function waitForLogout(
    handle: LogoutHandle,
    onStatus: (status: LogoutStatus) => void,
): Promise<void> {
    const { adapter, address, session } = handle;

    // Everything that can throw — including the consumer's onStatus — lives
    // inside this try so the finally is guaranteed to run and release the
    // WebSocket. Losing the destroy() would turn the CLI into a zombie.
    try {
        onStatus({ step: "disconnecting", address });
        const result = await adapter.sessions.disconnect(session);
        if (result.isOk()) {
            onStatus({ step: "success", address });
            return;
        }
        const reason = result.error.message || "remote unreachable";
        await clearLocalAppStorage();
        onStatus({ step: "partial", address, reason });
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        try {
            await clearLocalAppStorage();
            onStatus({ step: "partial", address, reason });
        } catch (cleanupErr) {
            const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
            onStatus({ step: "error", message: msg });
        }
    } finally {
        try {
            adapter.destroy();
        } catch {
            // best-effort
        }
    }
}

/**
 * Best-effort removal of this app's persisted state under `~/.polkadot-apps/`.
 *
 * Scoped by `${DAPP_ID}_` prefix so files belonging to other polkadot apps
 * sharing the directory (e.g. polkadot-desktop, other CLI tools) are left
 * alone. Errors are swallowed — this is a fallback, not a guarantee.
 *
 * Exported for tests; not part of the public API.
 * @internal
 */
export async function clearLocalAppStorage(
    dir: string = join(homedir(), ".polkadot-apps"),
): Promise<void> {
    // @parity/product-sdk-terminal's node-storage only writes flat `${appId}_${key}.json`
    // files, never subdirectories. Filter by isFile() anyway so a future change
    // up-stack (or an unrelated user stash) can't trip this helper.
    let entries: Dirent[];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return;
    }
    const prefix = `${DAPP_ID}_`;
    await Promise.all(
        entries
            .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
            .map((entry) =>
                unlink(join(dir, entry.name)).catch(() => {
                    // best-effort
                }),
            ),
    );
}
