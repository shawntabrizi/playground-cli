/**
 * Git and GitHub CLI utilities.
 */

import { execFile, exec } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

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

/** Run a command, streaming stdout+stderr to a log callback. */
function spawn(cmd: string, args: string[], options?: { cwd?: string; log?: Log }): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = execFile(cmd, args, { cwd: options?.cwd, env: PLAIN_ENV });
        const stderr: string[] = [];
        const forward = (data: Buffer | string) => {
            for (const line of sanitize(String(data)).split("\n").filter(Boolean)) {
                options?.log?.(line);
            }
        };
        proc.stdout?.on("data", forward);
        proc.stderr?.on("data", (data: Buffer | string) => {
            forward(data);
            stderr.push(String(data));
        });
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else {
                const detail = stderr.join("").trim().split("\n").pop() ?? "";
                reject(new Error(detail || `${cmd} failed (exit ${code})`));
            }
        });
    });
}

/** Check if the GitHub CLI is authenticated. */
export function isGhAuthenticated(): boolean {
    try {
        require("node:child_process").execSync("gh auth status", { stdio: "pipe" });
        return true;
    } catch {
        return false;
    }
}

/** Fork a repo on GitHub and clone it locally (SSH). Streams git output to log. */
export async function forkAndClone(
    repo: string,
    targetDir: string,
    options?: { branch?: string; log?: Log },
): Promise<void> {
    const args = ["repo", "fork", repo, "--clone", "--fork-name", targetDir];
    if (options?.branch) args.push("--", "--branch", options.branch);
    await spawn("gh", args, { log: options?.log });
    // gh repo fork --clone registers the upstream as a second remote, which makes
    // `git checkout <branch>` ambiguous when the same branches exist on the fork.
    // Tolerate a missing remote so a fork+clone that already succeeded isn't
    // marked failed by a stray non-zero exit here.
    await spawn("git", ["remote", "remove", "upstream"], {
        cwd: targetDir,
        log: options?.log,
    }).catch(() => {});
}

/** Clone a repo with fresh git history. Streams git output to log. */
export async function cloneRepo(
    repo: string,
    targetDir: string,
    options?: { branch?: string; log?: Log },
): Promise<void> {
    const args = ["clone"];
    if (options?.branch) args.push("--branch", options.branch);
    args.push(repo, targetDir);
    await spawn("git", args, { log: options?.log });
    rmSync(resolve(targetDir, ".git"), { recursive: true, force: true });
    options?.log?.("Initializing fresh git history...");
    await spawn("git", ["init"], { cwd: targetDir, log: options?.log });
}

/** Run a shell command, streaming output to log. */
export async function runCommand(cmd: string, options: { cwd?: string; log?: Log }): Promise<void> {
    const { cwd, log } = options;
    return new Promise((resolve, reject) => {
        const proc = exec(cmd, { cwd, env: PLAIN_ENV });
        const forward = (data: Buffer | string) => {
            for (const line of sanitize(String(data)).split("\n").filter(Boolean)) {
                log?.(line);
            }
        };
        proc.stdout?.on("data", forward);
        proc.stderr?.on("data", forward);
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command failed (exit ${code})`));
        });
    });
}
