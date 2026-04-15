import { Command } from "commander";

export const deployCommand = new Command("deploy")
    .description("Build and deploy contracts and frontend")
    .option("--suri <suri>", "Signer secret URI (e.g. //Alice for dev)")
    .option("--contracts", "Include contract build & deploy")
    .option("--skip-frontend", "Skip frontend build & deploy")
    .option("--domain <name>", "App domain (overrides package.json)")
    .action(async (opts) => {
        console.log("TODO: deploy", opts);
    });
