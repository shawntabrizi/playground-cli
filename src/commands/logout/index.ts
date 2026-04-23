import React from "react";
import { Command } from "commander";
import { render } from "ink";
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
    .action(async () => {
        console.log();

        const result = await lookupSession();

        if (result.kind === "error") {
            console.error(`  Could not reach the login service: ${result.message}\n`);
            process.exit(1);
        }

        if (result.kind === "empty") {
            console.log("  No account is signed in.\n");
            process.exit(0);
        }

        const app = render(
            React.createElement(LogoutScreen, {
                handle: result.handle,
                onDone: () => app.unmount(),
            }),
        );
        await app.waitUntilExit();

        console.log();
        process.exit(process.exitCode ?? 0);
    });
