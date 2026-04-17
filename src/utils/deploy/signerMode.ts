/**
 * Resolves *which* signer is used for each on-chain step of a deploy. This
 * is the only module that knows the full matrix; everywhere else receives
 * already-composed objects so a future mainnet profile can swap in without
 * rewriting callers.
 *
 * Today (testnet):
 *   - Dev mode: bulletin-deploy uses its built-in default mnemonic for
 *     storage AND DotNS. Playground publish (if enabled) still uses the
 *     user's phone signer so myApps ownership lands on the correct address.
 *   - Phone mode: bulletin-deploy uses the user's phone signer for DotNS
 *     (3 taps). Storage always uses the bulletin-deploy pool mnemonic.
 *     Playground publish uses the user's phone signer (1 more tap).
 */

import type { DeployOptions } from "bulletin-deploy";
import type { ResolvedSigner } from "../signer.js";

export type SignerMode = "dev" | "phone";

export interface DeploySignerSetup {
    /**
     * Options to pass to bulletin-deploy's `deploy()`. For dev mode this is
     * empty (bulletin-deploy falls back to its env / DEFAULT_MNEMONIC); for
     * phone mode we inject the user's signer so DotNS registration is paid
     * for by — and recorded against — their account.
     */
    bulletinDeployAuthOptions: Pick<DeployOptions, "signer" | "signerAddress" | "mnemonic">;

    /**
     * Signer used to call `registry.publish()` for the playground step. This
     * is always the user's phone signer (when available) because the contract
     * records `env::caller()` as the owner — that's what drives the myApps
     * view. `null` means we cannot publish (dev mode without a phone session).
     */
    publishSigner: ResolvedSigner | null;

    /**
     * Count of phone approvals the user should expect under this setup,
     * broken down by phase. Used to render the summary card.
     */
    approvals: DeployApproval[];
}

export interface DeployApproval {
    phase: "dotns" | "playground";
    label: string;
}

export interface ResolveOptions {
    mode: SignerMode;
    /** The user's phone (or --suri) signer, or null if not logged in. */
    userSigner: ResolvedSigner | null;
    /** Whether `--playground` / the prompt enabled playground publish. */
    publishToPlayground: boolean;
}

export function resolveSignerSetup(opts: ResolveOptions): DeploySignerSetup {
    const approvals: DeployApproval[] = [];

    let bulletinDeployAuthOptions: DeploySignerSetup["bulletinDeployAuthOptions"] = {};

    if (opts.mode === "phone") {
        if (!opts.userSigner) {
            throw new Error(
                'Phone signer requested but no session found. Run "dot init" to log in, or pass --signer dev.',
            );
        }
        bulletinDeployAuthOptions = {
            signer: opts.userSigner.signer,
            signerAddress: opts.userSigner.address,
        };
        approvals.push(
            { phase: "dotns", label: "Reserve domain (DotNS commitment)" },
            { phase: "dotns", label: "Finalize domain (DotNS register)" },
            { phase: "dotns", label: "Link content (DotNS setContenthash)" },
        );
    }

    // Playground publish always uses the user's signer so ownership ties to
    // their address — otherwise the registry would record a shared dev key
    // and the myApps view would be useless.
    let publishSigner: ResolvedSigner | null = null;
    if (opts.publishToPlayground) {
        if (!opts.userSigner) {
            throw new Error(
                'Publishing to Playground requires a logged-in account. Run "dot init" first, or drop --playground.',
            );
        }
        publishSigner = opts.userSigner;
        approvals.push({ phase: "playground", label: "Publish to Playground registry" });
    }

    return { bulletinDeployAuthOptions, publishSigner, approvals };
}
