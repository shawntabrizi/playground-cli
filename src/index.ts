#!/usr/bin/env node

import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { initCommand } from "./commands/init/index.js";
import { modCommand } from "./commands/mod.js";
import { buildCommand } from "./commands/build.js";
import { deployCommand } from "./commands/deploy.js";

const program = new Command()
    .name("dot")
    .description("CLI for Polkadot Playground")
    .version(pkg.version);

program.addCommand(initCommand);
program.addCommand(modCommand);
program.addCommand(buildCommand);
program.addCommand(deployCommand);

program.parse();
