/**
 * Public surface for programmatic deploy usage (RevX, automation, etc.).
 *
 * This module must not import React, Ink, or any CLI-specific code so it
 * remains safe to consume from a WebContainer. All Node-specific bits are
 * hidden inside the submodules and only surfaced through typed events.
 */

export {
    runDeploy,
    type DeployEvent,
    type DeployOutcome,
    type RunDeployOptions,
    type DeployPhase,
} from "./run.js";
export {
    publishToPlayground,
    normalizeDomain,
    normalizeGitRemote,
    readGitRemote,
    readReadme,
    README_CAP_BYTES,
    type PublishToPlaygroundOptions,
    type PublishToPlaygroundResult,
    type ReadmeStatus,
} from "./playground.js";
export {
    resolveSignerSetup,
    type SignerMode,
    type DeployApproval,
    type DeploySignerSetup,
} from "./signerMode.js";
export type { SigningEvent } from "./signingProxy.js";
export type { DeployLogEvent } from "./progress.js";
export {
    checkDomainAvailability,
    formatAvailability,
    type AvailabilityResult,
    type CheckAvailabilityOptions,
    type DeployPlan,
} from "./availability.js";

// Re-exported so SDK consumers (RevX) can tear down the shared Paseo client
// that `publishToPlayground` and `runDeploy` use internally. The CLI calls
// this itself from `deploy/index.ts` cleanupOnce; non-CLI consumers must
// call it once they're done with a run or the WebSocket keeps their event
// loop alive.
export { destroyConnection } from "../connection.js";
