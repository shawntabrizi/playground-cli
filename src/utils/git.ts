/**
 * Git and GitHub CLI utilities.
 */

import { exec } from "node:child_process";
import { createWriteStream } from "node:fs";

type Log = (line: string) => void;

// Strip ANSI escape codes, cursor movements, and carriage returns so child
// process output (including Ink programs like cdm) doesn't corrupt our UI.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI stripping
const ANSI_RE = /\x1B(?:\[[0-9;]*[A-Za-z]|\].*?\x07|[^[])/g;
function sanitize(s: string): string {
    return s.replace(ANSI_RE, "").replace(/\r/g, "");
}

/** Env vars that tell child processes to skip interactive/color output. */
const PLAIN_ENV = { ...process.env, TERM: "dumb", NO_COLOR: "1", CI: "1" };

/**
 * Run a shell command, streaming output to log.
 *
 * If `logFile` is provided, both stdout and stderr are also tee'd to that file
 * via createWriteStream — O(1) RAM regardless of total output volume. The file
 * contains the raw bytes (no ANSI stripping) so it round-trips faithfully when
 * `cat`ed back into a terminal.
 */
export async function runCommand(
    cmd: string,
    options: { cwd?: string; log?: Log; logFile?: string },
): Promise<void> {
    const { cwd, log, logFile } = options;
    return new Promise((resolve, reject) => {
        const proc = exec(cmd, { cwd, env: PLAIN_ENV });
        let file: ReturnType<typeof createWriteStream> | null = null;
        if (logFile) {
            file = createWriteStream(logFile);
            file.on("error", (err) => {
                log?.(`(log file write failed: ${err.message})`);
                file = null;
            });
        }
        const forward = (data: Buffer | string) => {
            file?.write(data);
            for (const line of sanitize(String(data)).split("\n").filter(Boolean)) {
                log?.(line);
            }
        };
        proc.stdout?.on("data", forward);
        proc.stderr?.on("data", forward);
        proc.on("close", (code) => {
            const settle = () =>
                code === 0 ? resolve() : reject(new Error(`Command failed (exit ${code})`));
            if (file) file.end(settle);
            else settle();
        });
    });
}
