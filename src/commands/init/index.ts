import React from "react";
import { Command } from "commander";
import { render } from "ink";
import { InitScreen } from "./InitScreen.js";
import { connect, type LoginHandle } from "../../utils/auth.js";

export const initCommand = new Command("init")
    .description("Install prerequisites and login via mobile QR")
    .option("-y, --yes", "Skip interactive prompts")
    .action(async (opts) => {
        console.log();

        let login: LoginHandle | null = null;
        let existingAddress: string | null = null;

        if (!opts.yes) {
            const result = await connect();
            if (result.kind === "existing") {
                existingAddress = result.address;
            } else {
                login = result.login;
                console.log("  Scan with the Polkadot mobile app to log in:\n");
                console.log(result.qrCode);
            }
        }

        const app = render(
            React.createElement(InitScreen, {
                login,
                existingAddress,
                onDone: () => app.unmount(),
            }),
        );
        await app.waitUntilExit();

        console.log();
        process.exit(process.exitCode ?? 0);
    });
