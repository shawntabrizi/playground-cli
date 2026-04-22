/**
 * Typed errors raised by the account-setup subsystem so callers (TUI, deploy
 * orchestrator) can render specific guidance instead of a raw message.
 */

/**
 * Thrown when every funder in `FUNDER_CHAIN` is below the threshold needed to
 * cover the requested transfer. Carries enough context for the caller to build
 * a faucet URL and a meaningful error message without importing the chain.
 */
export class AllFundersExhaustedError extends Error {
    constructor(
        public readonly userAddress: string,
        public readonly tried: readonly string[],
    ) {
        super(`All funders exhausted (tried: ${tried.join(", ")})`);
        this.name = "AllFundersExhaustedError";
    }
}
