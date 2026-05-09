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
