/**
 * QR login flow — pure business logic, no UI.
 *
 * Flow:
 *   1. `connect()` — starts adapter + auth, returns existing address OR QR code
 *   2. Print QR code to stdout (if needed) — before Ink mounts
 *   3. `waitForLogin()` — awaits the already-running auth to complete
 *   4. `getSessionSigner()` — gets a working signer for tx signing (separate adapter)
 */

import { ss58Encode } from "@polkadot-apps/address";
import {
    createTerminalAdapter,
    waitForSessions,
    renderQrCode,
    type TerminalAdapter,
    type PairingStatus,
    type AttestationStatus,
} from "@polkadot-apps/terminal";
import { createTxSigner } from "./signer.js";
import type { PolkadotSigner } from "polkadot-api";

const DEFAULT_METADATA_URL =
    "https://gist.githubusercontent.com/ReinhardHatko/1967dd3f4afe78683cc0ba14d6ec8744/raw/c1625eb7ed7671b7e09a3fa2a25998dde33c70b8/metadata.json";
const DEFAULT_PEOPLE_ENDPOINTS = ["wss://paseo-people-next-rpc.polkadot.io"];

/** How long we wait for the statement store to publish the pairing QR. */
const QR_TIMEOUT_MS = 60_000;

function createAdapter(): TerminalAdapter {
    return createTerminalAdapter({
        appId: "dot-cli",
        metadataUrl: DEFAULT_METADATA_URL,
        endpoints: DEFAULT_PEOPLE_ENDPOINTS,
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
