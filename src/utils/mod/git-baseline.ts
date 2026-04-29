import { runCommand } from "../git.js";
import { commandExists } from "../toolchain.js";

type Log = (line: string) => void;

function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function createOptionalGitBaseline(
    targetDir: string,
    domain: string,
    log: Log,
    logFile?: string,
): Promise<void> {
    try {
        if (!(await commandExists("git"))) {
            log("git not on PATH — skipping git init (mod still works, you can init later)");
            return;
        }

        log("initializing fresh git history…");
        await runCommand("git init", { cwd: targetDir, log, logFile });
        await runCommand("git add -A", { cwd: targetDir, log, logFile });

        log("creating unsigned baseline commit…");
        await runCommand(
            `git commit --no-gpg-sign -m ${shellQuote(`Initial commit from ${domain}`)}`,
            { cwd: targetDir, log, logFile },
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`git baseline skipped: ${message}`);
    }
}
