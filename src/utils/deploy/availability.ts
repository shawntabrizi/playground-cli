/**
 * Preflight domain availability check.
 *
 * Hits two view-only DotNS calls via bulletin-deploy's `DotNS` class:
 *
 *   - `classifyName(label)` — PopOracle classification
 *       - `Reserved` → hard block (nobody can register).
 *       - `PoP Lite/Full` → advisory note; bulletin-deploy self-attests
 *         during register on testnet.
 *   - `checkOwnership(label, userH160?)` — catches names registered to
 *     a different account *before* we build + upload. When the caller
 *     passes their own H160 (derived from SS58 via `ss58ToH160`), a
 *     domain owned BY them returns `status: "available"` with a note —
 *     this is the re-deploy / update path, not a block.
 */

import { DotNS } from "bulletin-deploy";
import { ss58ToH160 } from "@polkadot-apps/address";
import { normalizeDomain } from "./playground.js";
import { getChainConfig, type Env } from "../../config.js";

/** Mirror of bulletin-deploy's `ProofOfPersonhoodStatus` enum. Kept local so we don't couple to internals. */
const POP_STATUS_RESERVED = 3;
const POP_STATUS_LITE = 1;
const POP_STATUS_FULL = 2;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export type AvailabilityResult =
    | { status: "available"; label: string; fullDomain: string; note?: string }
    | { status: "reserved"; label: string; fullDomain: string; message: string }
    | { status: "taken"; label: string; fullDomain: string; owner: string }
    | { status: "unknown"; label: string; fullDomain: string; message: string };

export interface CheckAvailabilityOptions {
    env?: Env;
    /** Optional timeout in ms. Each RPC call has its own internal timeout. */
    timeoutMs?: number;
    /**
     * The deploying account's SS58 address. When provided we derive its H160
     * via `ss58ToH160` and treat "owned by you" as an update path rather than
     * a `taken` block. Omit in dev-mode-without-signer and we skip the
     * ownership check entirely (bulletin-deploy's own preflight is the
     * ultimate source of truth when the real signer is used).
     */
    ownerSs58Address?: string;
}

export async function checkDomainAvailability(
    domain: string,
    options: CheckAvailabilityOptions = {},
): Promise<AvailabilityResult> {
    const { label, fullDomain } = normalizeDomain(domain);
    const cfg = getChainConfig(options.env);

    // DotNS connect pings RPC + does an `ensureAccountMapped` tx if the dev
    // account isn't mapped yet. On testnet the default account is already
    // mapped, so this is effectively a pure read path — no phone prompts.
    const dotns = new DotNS();
    try {
        await withTimeout(
            dotns.connect({ rpc: cfg.assetHubRpc }),
            options.timeoutMs ?? 30_000,
            "DotNS connect",
        );

        const classification = await dotns.classifyName(label);
        if (classification.requiredStatus === POP_STATUS_RESERVED) {
            return {
                status: "reserved",
                label,
                fullDomain,
                message: classification.message || "Reserved for Governance",
            };
        }

        // Ownership check — pass the user's H160 so "owned by you" is
        // correctly identified as an update path rather than a block.
        // When the caller doesn't know (dev mode with no session), we skip
        // the ownership check and let bulletin-deploy's own preflight
        // (which always has the right signer) make the final call.
        const userH160 = options.ownerSs58Address ? ss58ToH160(options.ownerSs58Address) : null;

        if (userH160) {
            const { owned, owner } = await dotns.checkOwnership(label, userH160);
            if (owner && owner.toLowerCase() !== ZERO_ADDRESS && !owned) {
                return { status: "taken", label, fullDomain, owner };
            }
            if (owned) {
                return {
                    status: "available",
                    label,
                    fullDomain,
                    note: "Already owned by you — will update the existing deployment.",
                };
            }
        }

        // Names that require Proof-of-Personhood are still registrable on
        // testnet — bulletin-deploy self-attests during `register()` via
        // `setUserPopStatus`. Surface it as an advisory note, not a blocker.
        if (
            classification.requiredStatus === POP_STATUS_LITE ||
            classification.requiredStatus === POP_STATUS_FULL
        ) {
            const requirement = classification.requiredStatus === POP_STATUS_FULL ? "Full" : "Lite";
            return {
                status: "available",
                label,
                fullDomain,
                note: `Requires Proof of Personhood (${requirement}). Will be set up automatically.`,
            };
        }

        return { status: "available", label, fullDomain };
    } catch (err) {
        return {
            status: "unknown",
            label,
            fullDomain,
            message: err instanceof Error ? err.message : String(err),
        };
    } finally {
        try {
            dotns.disconnect();
        } catch {
            // best-effort — disconnect is idempotent in practice
        }
    }
}

/** Human-readable single-line summary for the TUI / CLI. */
export function formatAvailability(result: AvailabilityResult): string {
    switch (result.status) {
        case "available":
            return result.note
                ? `${result.fullDomain} is available — ${result.note}`
                : `${result.fullDomain} is available`;
        case "reserved":
            return `${result.fullDomain} is reserved — ${result.message}`;
        case "taken":
            return `${result.fullDomain} is already registered by ${result.owner} — transfer it or use a different name`;
        case "unknown":
            return `Could not verify ${result.fullDomain}: ${result.message}`;
    }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
        ),
    ]);
}
