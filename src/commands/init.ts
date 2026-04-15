import { Command } from "commander";

export const initCommand = new Command("init")
    .description("Install prerequisites and login via mobile QR")
    .action(async () => {
        console.log("TODO: init");
    });
