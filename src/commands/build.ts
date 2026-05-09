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

import { Command } from "commander";
import { withSpan, errorMessage } from "../telemetry.js";
import { runCliCommand } from "../cli-runtime.js";
import { runBuild, loadDetectInput, detectBuildConfig } from "../utils/build/index.js";

export const buildCommand = new Command("build")
    .description("Auto-detect and run the project's build")
    .option("--dir <path>", "Project directory", process.cwd())
    .action(async (opts: { dir: string }) =>
        runCliCommand("build", { hardExit: true }, async () => {
            try {
                const config = await withSpan("cli.build.detect", "detect build config", () =>
                    detectBuildConfig(loadDetectInput(opts.dir)),
                );
                process.stdout.write(`\n> ${config.description}\n\n`);

                const result = await withSpan("cli.build.run", config.description, () =>
                    runBuild({
                        cwd: opts.dir,
                        config,
                        onData: (line) => process.stdout.write(`${line}\n`),
                    }),
                );

                process.stdout.write(`\n✔ Build succeeded → ${result.outputDir}\n`);
            } catch (err) {
                process.stderr.write(`\n✖ ${errorMessage(err)}\n`);
                process.exitCode = 1;
                throw err;
            }
        }),
    );
