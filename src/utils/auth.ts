/**
 * QR login flow — pure business logic, no UI.
 *
 * Flow:
 *   1. `connect()` — starts adapter + auth, returns existing session OR QR code
 *   2. Print QR code to stdout (if needed) — before Ink mounts
 *   3. `waitForLogin()` — awaits the already-running auth to complete
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

const DEFAULT_METADATA_URL =
    "https://gist.githubusercontent.com/ReinhardHatko/1967dd3f4afe78683cc0ba14d6ec8744/raw/c1625eb7ed7671b7e09a3fa2a25998dde33c70b8/metadata.json";
const DEFAULT_PEOPLE_ENDPOINTS = ["wss://paseo-people-next-rpc.polkadot.io"];

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
 * Returns immediately if an existing session is found.
 * Otherwise kicks off authenticate(), waits for the QR payload,
 * and returns the QR code + a handle to await the auth result.
 */
export async function connect(): Promise<ConnectResult> {
    const adapter = createTerminalAdapter({
        appId: "dot-cli",
        metadataUrl: DEFAULT_METADATA_URL,
        endpoints: DEFAULT_PEOPLE_ENDPOINTS,
    });

    const sessions = await waitForSessions(adapter);
    if (sessions.length > 0) {
        const pubkey = new Uint8Array(sessions[0].remoteAccount.accountId);
        return { kind: "existing", address: ss58Encode(pubkey) };
    }

    // Start authenticate — this triggers the pairing flow and QR emission
    const authPromise = adapter.sso.authenticate();

    // Wait for the QR payload (with timeout)
    const qrCode = await Promise.race([
        new Promise<string>((resolve) => {
            let done = false;
            const unsub = adapter.sso.pairingStatus.subscribe(async (status: PairingStatus) => {
                if (status.step === "pairing" && !done) {
                    done = true;
                    unsub();
                    resolve(await renderQrCode(status.payload));
                }
            });
        }),
        new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error("Timed out waiting for login service — check your network")),
                30_000,
            ),
        ),
    ]);

    return { kind: "qr", qrCode, login: { adapter, authPromise } };
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

    // Await the auth that was started in connect()
    const result = await authPromise;
    unsubPairing();
    unsubAttestation();

    let address: string | null = null;
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

    if (address) {
        await waitForSessions(adapter, 3000);
    }

    return address;
    // Skip adapter.destroy() — causes async DestroyedError noise.
}
