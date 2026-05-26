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

import { describe, expect, it } from "vitest";
import { describeDeployEvent } from "./run.js";

describe("describeDeployEvent", () => {
    it("renders chunk-progress as a human-readable upload line", () => {
        expect(describeDeployEvent({ kind: "chunk-progress", current: 3, total: 7 })).toBe(
            "uploading chunk 3/7",
        );
    });

    it("passes info messages through verbatim", () => {
        expect(describeDeployEvent({ kind: "info", message: "reserving domain" })).toBe(
            "reserving domain",
        );
    });

    it("drops phase-start banners (step rows / phase headers convey those)", () => {
        // This is the bug the rewrite fixed: phase banners used to surface as
        // the raw "phase-start" string in the log tail.
        expect(describeDeployEvent({ kind: "phase-start", phase: "storage" })).toBeNull();
    });
});
