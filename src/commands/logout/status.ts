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
 * Pure mapping from a `LogoutStatus` to the props the <Row> primitive needs.
 *
 * Lives in its own file (not `.tsx`) so the test runner can import it without
 * dragging React + Ink through vitest — same convention as `completion.ts`
 * next to `InitScreen.tsx`.
 */

import type { LogoutStatus } from "../../utils/auth.js";
import type { MarkKind, RowProps } from "../../utils/ui/theme/index.js";

export interface RowSpec {
    mark: MarkKind;
    label: string;
    value?: string;
    hint?: string;
    tone?: RowProps["tone"];
}

/** Terminal statuses = we're done, caller can unmount. */
export function isTerminal(status: LogoutStatus): boolean {
    return status.step === "success" || status.step === "partial" || status.step === "error";
}

export function statusToRow(status: LogoutStatus): RowSpec {
    switch (status.step) {
        case "disconnecting":
            return {
                mark: "run",
                label: "sign out",
                value: status.address,
                tone: "muted",
            };
        case "success":
            return {
                mark: "ok",
                label: "signed out",
                value: status.address,
                tone: "muted",
            };
        case "partial":
            return {
                mark: "warn",
                label: "signed out locally",
                value: status.address,
                tone: "warning",
                hint: `mobile app may still show this connection (${status.reason})`,
            };
        case "error":
            return {
                mark: "fail",
                label: "sign out failed",
                value: status.message,
                tone: "danger",
            };
    }
}
