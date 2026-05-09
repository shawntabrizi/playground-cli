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

import { Row } from "../../utils/ui/theme/index.js";
import { statusToRow } from "./status.js";
import type { LogoutStatus as LogoutStatusType } from "../../utils/auth.js";

/**
 * Single-row presentational view of the current sign-out step. Pure — all
 * visual/copy decisions live in `statusToRow` so they're unit-testable.
 */
export function LogoutStatus({ status }: { status: LogoutStatusType }) {
    const spec = statusToRow(status);
    return (
        <Row
            mark={spec.mark}
            label={spec.label}
            value={spec.value}
            hint={spec.hint}
            tone={spec.tone}
        />
    );
}
