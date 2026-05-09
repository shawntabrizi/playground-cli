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

import { runCommand } from "../git.js";
import { commandExists } from "../toolchain.js";

type Log = (line: string) => void;

/**
 * Initialise an empty git history in the freshly-extracted mod tree so the
 * user can start tracking changes immediately. We deliberately do NOT create
 * a baseline commit — that would require `user.name`/`user.email` to be
 * configured globally, and the user is going to commit + push to their own
 * GitHub repo anyway as part of the `dot deploy --moddable` workflow.
 *
 * `git init` is purely local: no network, no auth, no GitHub credentials.
 * If `git` is not on PATH we just log and continue — the directory still
 * works without version control.
 */
export async function createOptionalGitBaseline(
    targetDir: string,
    log: Log,
    logFile?: string,
): Promise<void> {
    try {
        if (!(await commandExists("git"))) {
            log("git not on PATH — skipping git init (mod still works, you can init later)");
            return;
        }

        log("initializing fresh git history…");
        await runCommand("git init", { cwd: targetDir, log, logFile });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`git baseline skipped: ${message}`);
    }
}
