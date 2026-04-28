/**
 * `dot deploy --modable` preflight: ensures git+gh are installed and
 * authenticated, then resolves the public GitHub URL we'll record in the
 * Bulletin metadata.
 *
 * The pure `decideRepositoryAction` separates the decision from the I/O so
 * the branching logic is unit-testable without mocking child_process.
 */

import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { commandExists, TOOL_STEPS } from "../toolchain.js";

const execFileAsync = promisify(execFile);

export type RepositoryAction =
    | { kind: "use-origin"; url: string }
    | { kind: "create"; repoName: string }
    | { kind: "needs-repo-name" };

export interface DecisionInput {
    originUrl: string | null;
    repoName: string | null;
}

export function decideRepositoryAction(input: DecisionInput): RepositoryAction {
    if (input.originUrl) {
        const normalised = input.originUrl.replace(/\.git$/, "");
        return { kind: "use-origin", url: normalised };
    }
    if (input.repoName) return { kind: "create", repoName: input.repoName };
    return { kind: "needs-repo-name" };
}

export class ModablePreflightError extends Error {}

export async function ensureGitInstalled(onLog?: (line: string) => void): Promise<void> {
    if (await commandExists("git")) return;
    const step = TOOL_STEPS.find((s) => s.name === "git");
    if (!step) throw new ModablePreflightError("internal: git step missing from TOOL_STEPS");
    await step.install(onLog);
}

export async function ensureGhInstalled(onLog?: (line: string) => void): Promise<void> {
    if (await commandExists("gh")) return;
    const step = TOOL_STEPS.find((s) => s.name === "GitHub CLI");
    if (!step) throw new ModablePreflightError("internal: gh step missing from TOOL_STEPS");
    await step.install(onLog);
}

export async function ensureGhAuthed(opts: { interactive: boolean }): Promise<void> {
    try {
        await execFileAsync("gh", ["auth", "status"]);
        return;
    } catch {}
    if (!opts.interactive) {
        throw new ModablePreflightError(
            'gh is not authenticated. Run "gh auth login" and retry, or pass --no-modable to skip publishing source.',
        );
    }
    await new Promise<void>((resolveP, rejectP) => {
        const child = spawn("gh", ["auth", "login"], { stdio: "inherit" });
        child.on("exit", (code) =>
            code === 0
                ? resolveP()
                : rejectP(new ModablePreflightError(`gh auth login exited with code ${code}`)),
        );
        child.on("error", rejectP);
    });
}

function readOrigin(cwd: string): string | null {
    try {
        const raw = execFileSync("git", ["remote", "get-url", "origin"], {
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
            cwd,
        });
        return raw.trim();
    } catch {
        return null;
    }
}

export interface ResolveRepoOptions {
    cwd: string;
    repoName: string | null;
    onLog?: (line: string) => void;
}

export async function resolveRepositoryUrl(opts: ResolveRepoOptions): Promise<string> {
    const action = decideRepositoryAction({
        originUrl: readOrigin(opts.cwd),
        repoName: opts.repoName,
    });
    if (action.kind === "needs-repo-name") {
        throw new ModablePreflightError(
            "modable preflight: repo name is required when no origin is set",
        );
    }
    if (action.kind === "use-origin") {
        opts.onLog?.(`pushing HEAD to existing origin (${action.url})…`);
        try {
            await execFileAsync("git", ["push", "origin", "HEAD"], { cwd: opts.cwd });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new ModablePreflightError(
                `Push to origin failed: ${msg}. Resolve and retry, or pass --no-modable.`,
            );
        }
        return action.url;
    }
    opts.onLog?.(`creating public github repo "${action.repoName}" and pushing…`);
    try {
        await execFileAsync(
            "gh",
            [
                "repo",
                "create",
                action.repoName,
                "--public",
                "--source=.",
                "--push",
                "--remote=origin",
            ],
            { cwd: opts.cwd },
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new ModablePreflightError(`gh repo create failed: ${msg}`);
    }
    const created = readOrigin(opts.cwd);
    if (!created) {
        throw new ModablePreflightError(
            "gh repo create succeeded but origin was not set — investigate manually",
        );
    }
    return created.replace(/\.git$/, "");
}
