import React from "react";
import { Command } from "commander";
import { render } from "ink";
import { DependencyList } from "./DependencyList.js";

export const initCommand = new Command("init")
    .description("Install prerequisites and login via mobile QR")
    .option("-y, --yes", "Skip interactive prompts")
    .action(async (opts) => {
        console.log();

        await new Promise<void>((resolve) => {
            const app = render(
                React.createElement(DependencyList, {
                    skipAuth: opts.yes ?? false,
                    onDone: resolve,
                }),
            );
            app.waitUntilExit().then(resolve);
        });

        console.log();
        process.exit(process.exitCode ?? 0);
    });
