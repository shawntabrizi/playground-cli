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
import { pickNextStage } from "./DeployScreen.js";

describe("pickNextStage", () => {
    it("continues past moddable preflight once a repository URL is resolved", () => {
        expect(
            pickNextStage(
                false,
                "phone",
                "dist",
                "tw33d3r.dot",
                true,
                false,
                true,
                "git@github.com:charlesHetterich/tw33d3r",
            ),
        ).toEqual({ kind: "confirm" });
    });

    it("enters moddable preflight when moddable is true and no repository URL is resolved yet", () => {
        expect(
            pickNextStage(false, "phone", "dist", "tw33d3r.dot", true, false, true, null),
        ).toEqual({ kind: "moddable-preflight" });
    });
});
