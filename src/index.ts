#!/usr/bin/env node

import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };

const program = new Command()
    .name("dot")
    .description("CLI for Polkadot Playground")
    .version(pkg.version);

program.parse();
