// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

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
    buildMetadata,
    normalizeDomain,
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
