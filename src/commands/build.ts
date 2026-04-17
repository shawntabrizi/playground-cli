import { Command } from "commander";
import { runBuild, loadDetectInput, detectBuildConfig } from "../utils/build/index.js";

export const buildCommand = new Command("build")
    .description("Auto-detect and run the project's build")
    .option("--dir <path>", "Project directory", process.cwd())
    .action(async (opts: { dir: string }) => {
        try {
            const config = detectBuildConfig(loadDetectInput(opts.dir));
            process.stdout.write(`\n> ${config.description}\n\n`);

            const result = await runBuild({
                cwd: opts.dir,
                config,
                onData: (line) => process.stdout.write(`${line}\n`),
            });

            process.stdout.write(`\n✔ Build succeeded → ${result.outputDir}\n`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`\n✖ ${msg}\n`);
            process.exit(1);
        }
    });
