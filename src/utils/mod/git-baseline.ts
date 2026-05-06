import { runCommand } from "../git.js";
import { commandExists } from "../toolchain.js";

type Log = (line: string) => void;

/**
 * Initialise an empty git history in the freshly-extracted mod tree so the
 * user can start tracking changes immediately. We deliberately do NOT create
 * a baseline commit — that would require `user.name`/`user.email` to be
 * configured globally, and the user is going to commit + push to their own
 * GitHub repo anyway as part of the `dot deploy --modable` workflow.
 *
 * `git init` is purely local: no network, no auth, no GitHub credentials.
 * If `git` is not on PATH we just log and continue — the directory still
 * works without version control.
 */
export async function createOptionalGitBaseline(
    targetDir: string,
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
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`git baseline skipped: ${message}`);
    }
}
