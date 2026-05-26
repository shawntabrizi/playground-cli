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
 * Pure predicate over the three parallel init streams (deps / auth / account
 * setup). Lives in its own file so tests can import it without dragging React
 * + Ink into the test runner.
 */
export interface InitCompletionState {
    needsQr: boolean;
    authResolved: boolean;
    loggedInAddress: string | null;
    depsComplete: boolean;
    accountComplete: boolean;
    /**
     * The username prompt only runs once a session exists AND the account
     * setup has succeeded (allowances + funding are prerequisites for the
     * `setUsername` tx). When `loggedInAddress` is null we treat this step
     * as not applicable, same as `accountComplete`.
     */
    usernameComplete: boolean;
}

export function computeAllDone(state: InitCompletionState): boolean {
    const needsAccountSetup = state.loggedInAddress !== null;
    return (
        state.depsComplete &&
        state.authResolved &&
        (needsAccountSetup ? state.accountComplete && state.usernameComplete : true)
    );
}
