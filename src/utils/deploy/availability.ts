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
const POP_STATUS_NO_STATUS = 0;
const POP_STATUS_LITE = 1;
const POP_STATUS_FULL = 2;
const POP_STATUS_RESERVED = 3;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Mirror of `simulateUserStatus` from bulletin-deploy. Reproduced (not
 * imported) because the helper isn't exported from the package root and we
 * don't want to reach into `bulletin-deploy/dist/dotns.js`. If the upstream
 * rule set changes, this needs to track it — but the rule is small and has
 * been stable since the preflight feature shipped in 0.6.9-rc.5.
 *
 * Predicts the user's PoP status AFTER `registerDomain`'s internal
 * `setUserPopStatus` call completes. Used here to decide whether
 * bulletin-deploy will actually submit that extra tx — which determines
 * whether we count 3 or 4 DotNS approvals in the summary card.
 */
function predictPostRegisterPopStatus(
    currentStatus: number,
    requiredStatus: number,
    isTestnet: boolean,
): number {
    const max = (a: number, b: number) => (a > b ? a : b);
    if (requiredStatus === POP_STATUS_NO_STATUS && currentStatus === POP_STATUS_LITE && isTestnet) {
        // Paseo auto-escape: Lite signer on a NoStatus label gets bumped to
        // Full so `PopRules.priceWithCheck` accepts the signer. Mainnet path
        // never triggers this branch.
        return POP_STATUS_FULL;
    }
    if (requiredStatus !== POP_STATUS_NO_STATUS) {
        return max(currentStatus, requiredStatus);
    }
    return currentStatus;
}

/**
 * What bulletin-deploy will actually submit on-chain, in order. The TUI uses
 * this to render a correct "N phone taps" count BEFORE the user confirms —
 * the previous hard-coded "3 DotNS taps" assumption missed the extra
 * `setUserPopStatus` tap that fires whenever the classifier demands a PoP
 * level above the user's current one (e.g. short NoStatus name + Lite signer,
 * or any PoP-gated name + NoStatus signer). Seeing "step 5 of 4" after the
 * fact is a worse UX than predicting "5" upfront.
 */
export interface DeployPlan {
    /** `register` = new domain (commit + reveal + setContenthash, ± setUserPopStatus). `update` = already owned by us; only setContenthash fires. */
    action: "register" | "update";
    /** True iff bulletin-deploy will submit a `setUserPopStatus` tx before `register()`. */
    needsPopUpgrade: boolean;
}

export type AvailabilityResult =
    | {
          status: "available";
          label: string;
          fullDomain: string;
          note?: string;
          plan: DeployPlan;
      }
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
                    plan: { action: "update", needsPopUpgrade: false },
                };
            }
        }

        // Whether bulletin-deploy will fire `setUserPopStatus` before
        // `register()` is a pure function of (classifier requirement, user's
        // current status, chain = testnet). Reading getUserPopStatus requires
        // an EVM address — if the caller didn't supply one, we can't tell,
        // so we assume no upgrade (the counter will self-correct at runtime).
        let needsPopUpgrade = false;
        if (userH160) {
            try {
                const [userStatus, isTestnet] = await Promise.all([
                    dotns.getUserPopStatus(userH160),
                    dotns.isTestnet(),
                ]);
                const target = predictPostRegisterPopStatus(
                    userStatus,
                    classification.requiredStatus,
                    isTestnet,
                );
                needsPopUpgrade = target !== userStatus && target !== POP_STATUS_NO_STATUS;
            } catch {
                // RPC flake here shouldn't block the availability check —
                // under-counting DotNS approvals is recoverable at runtime
                // via the counter's clamp-up safety net.
            }
        }

        const plan: DeployPlan = { action: "register", needsPopUpgrade };

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
                plan,
            };
        }

        return { status: "available", label, fullDomain, plan };
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
