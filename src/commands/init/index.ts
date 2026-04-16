import React from "react";
import { Command } from "commander";
import { render } from "ink";
import { DependencyList } from "./DependencyList.js";

export const initCommand = new Command("init")
    .description("Install prerequisites and login via mobile QR")
    .action(async () => {
        console.log();

        await new Promise<void>((resolve) => {
            const app = render(React.createElement(DependencyList, { onDone: resolve }));
            app.waitUntilExit().then(resolve);
        });

        console.log();
        process.exit(process.exitCode ?? 0);
    });
