import { Command } from "commander";

export const buildCommand = new Command("build")
    .description("Detect and build all contracts and frontend")
    .action(async () => {
        console.log("TODO: build");
    });
