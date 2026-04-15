import { Command } from "commander";

export const modCommand = new Command("mod")
    .description("Clone a playground app template")
    .argument("[domain]", "App domain to clone (interactive picker if omitted)")
    .action(async (domain, opts) => {
        console.log("TODO: mod", { domain, ...opts });
    });
