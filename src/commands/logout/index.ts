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

import React from "react";
import { Command } from "commander";
import { render } from "ink";
import { withSpan } from "../../telemetry.js";
import { runCliCommand } from "../../cli-runtime.js";
import { findSession, type LogoutHandle } from "../../utils/auth.js";
import { LogoutScreen } from "./LogoutScreen.js";

// Tagged result so the three outcomes — session found, no session, lookup
// failed — stay distinguishable without piggy-backing on `process.exitCode`.
type LookupResult =
    | { kind: "found"; handle: LogoutHandle }
    | { kind: "empty" }
    | { kind: "error"; message: string };

async function lookupSession(): Promise<LookupResult> {
    try {
        const handle = await findSession();
        return handle ? { kind: "found", handle } : { kind: "empty" };
    } catch (err) {
        return {
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
        };
    }
}

export const logoutCommand = new Command("logout")
    .description("Sign out of the account paired via `dot init`")
    .action(async () =>
        runCliCommand("logout", { hardExit: true }, async () => {
            console.log();

            const result = await withSpan("cli.logout.lookup", "lookup session", lookupSession);

            if (result.kind === "error") {
                console.error(`  Could not reach the login service: ${result.message}\n`);
                process.exitCode = 1;
                throw new Error(result.message);
            }

            if (result.kind === "empty") {
                console.log("  No account is signed in.\n");
                process.exitCode = 0;
                return;
            }

            const app = render(
                React.createElement(LogoutScreen, {
                    handle: result.handle,
                    onDone: () => app.unmount(),
                }),
            );
            await withSpan("cli.logout.tui", "logout session", () => app.waitUntilExit());

            console.log();
        }),
    );
