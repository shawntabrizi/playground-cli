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

import { defineConfig } from "vitest/config";

const isCI = process.env.CI === "true";

export default defineConfig({
    test: {
        include: ["e2e/**/*.test.ts"],
        testTimeout: 120_000,
        hookTimeout: 60_000,
        globalSetup: ["e2e/cli/setup/global.ts"],
        fileParallelism: false,
        // Chain client WebSockets may keep the event loop alive after teardown.
        // Force exit after tests complete rather than hanging.
        teardownTimeout: 5_000,
        // Always emit JUnit XML for the report job. Add a human-readable
        // streaming reporter on local runs so developers see live progress;
        // CI runs strip it because the run logs are noisy enough already.
        reporters: isCI ? ["junit"] : ["default", "junit"],
        outputFile: { junit: "e2e-reports/junit.xml" },
    },
});
