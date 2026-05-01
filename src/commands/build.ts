import { Command } from "commander";
import { withSpan, errorMessage } from "../telemetry.js";
import { runCliCommand } from "../cli-runtime.js";
import { runBuild, loadDetectInput, detectBuildConfig } from "../utils/build/index.js";

export const buildCommand = new Command("build")
    .description("Auto-detect and run the project's build")
    .option("--dir <path>", "Project directory", process.cwd())
    .action(async (opts: { dir: string }) =>
        runCliCommand("build", { hardExit: true }, async () => {
            try {
                const config = await withSpan("cli.build.detect", "detect build config", () =>
                    detectBuildConfig(loadDetectInput(opts.dir)),
                );
                process.stdout.write(`\n> ${config.description}\n\n`);

                const result = await withSpan("cli.build.run", config.description, () =>
                    runBuild({
                        cwd: opts.dir,
                        config,
                        onData: (line) => process.stdout.write(`${line}\n`),
                    }),
                );

                process.stdout.write(`\n✔ Build succeeded → ${result.outputDir}\n`);
            } catch (err) {
                process.stderr.write(`\n✖ ${errorMessage(err)}\n`);
                process.exitCode = 1;
                throw err;
            }
        }),
    );
