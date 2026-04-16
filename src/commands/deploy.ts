import { Command } from "commander";

export const deployCommand = new Command("deploy")
    .description("Build and deploy contracts and frontend")
    .option("--suri <suri>", "Signer secret URI (e.g. //Alice for dev)")
    .option("--contracts", "Include contract build & deploy")
    .option("--skip-frontend", "Skip frontend build & deploy")
    .option("--domain <name>", "App domain (overrides package.json)")
    .option("--playground", "Publish to the playground registry")
    .option("--env <env>", "Target environment: testnet or mainnet", "testnet")
    .option("-y, --yes", "Skip interactive prompts")
    .action(async (opts) => {
        console.log("TODO: deploy", opts);
    });
