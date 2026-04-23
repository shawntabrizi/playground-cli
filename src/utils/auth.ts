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
import { ss58Encode } from "@polkadot-apps/address";
import {
    createTerminalAdapter,
    waitForSessions,
    renderQrCode,
    type TerminalAdapter,
    type PairingStatus,
    type AttestationStatus,
    type StoredUserSession,
} from "@polkadot-apps/terminal";
import { createTxSigner } from "./session-signer-patch.js";
import type { PolkadotSigner } from "polkadot-api";
import { DAPP_ID, TERMINAL_METADATA_URL, getChainConfig } from "../config.js";

/** How long we wait for the statement store to publish the pairing QR. */
const QR_TIMEOUT_MS = 60_000;

function createAdapter(): TerminalAdapter {
    return createTerminalAdapter({
        appId: DAPP_ID,
        metadataUrl: TERMINAL_METADATA_URL,
        endpoints: getChainConfig().peopleEndpoints,
    });
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
        const pubkey = new Uint8Array(sessions[0].remoteAccount.accountId);
        return { kind: "existing", address: ss58Encode(pubkey) };
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

    let address: string | null = null;
    try {
        const result = await authPromise;
        result.match(
            (session) => {
                if (session) {
                    const pubkey = new Uint8Array(session.remoteAccount.accountId);
                    address = ss58Encode(pubkey);
                    onStatus({ step: "success", address });
                }
            },
            (error) => {
                onStatus({ step: "error", message: error.message });
            },
        );
    } finally {
        // Always clear subscriptions, even if authPromise rejects.
        unsubPairing();
        unsubAttestation();
    }

    if (address) {
        await waitForSessions(adapter, 3000);
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
    const pubkey = new Uint8Array(session.remoteAccount.accountId);
    const address = ss58Encode(pubkey);
    const signer = createTxSigner(session);

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
    session: StoredUserSession;
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
    const pubkey = new Uint8Array(session.remoteAccount.accountId);
    const address = ss58Encode(pubkey);
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
    // @polkadot-apps/terminal's node-storage only writes flat `${appId}_${key}.json`
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
