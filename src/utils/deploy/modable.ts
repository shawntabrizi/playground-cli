/**
 * `dot deploy --modable` preflight: resolves the public GitHub URL we'll
 * record in the Bulletin metadata. Existing origins are used as-is; gh auth
 * is only needed when we have to create and push a new public repo.
 *
 * The pure `decideRepositoryAction` separates the decision from the I/O so
 * the branching logic is unit-testable without mocking child_process.
 */

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { commandExists, TOOL_STEPS } from "../toolchain.js";
import { parseGitHubRepoUrl } from "../mod/source.js";

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

/**
 * Ensure `gh` is authenticated. We deliberately do NOT shell out to
 * `gh auth login` from here — even when called from the interactive deploy,
 * Ink owns stdout/stdin and a `stdio: "inherit"` child would race Ink for
 * keystrokes and produce a garbled UI. Instead, repo-creation paths fail with
 * the same actionable message: run `gh auth login` once outside `dot`, then
 * retry. The auth persists across runs, so this is a one-time speedbump per
 * machine.
 */
export async function ensureGhAuthed(): Promise<void> {
    try {
        await execFileAsync("gh", ["auth", "status"]);
        return;
    } catch {
        throw new ModablePreflightError(
            'gh is not authenticated. Run "gh auth login" and retry, or pass --no-modable to skip publishing source.',
        );
    }
}

export function readOrigin(cwd: string): string | null {
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
    fetch?: typeof fetch;
}

/**
 * Verifies that a GitHub repository URL is publicly accessible.
 *
 * Issues a `HEAD https://github.com/{owner}/{repo}` against the regular
 * HTML page rather than `api.github.com/repos/{owner}/{repo}` — the HTML
 * surface is NOT subject to the 60/hour anonymous-IP API rate limit that
 * gets exhausted on shared networks (hackathon WiFi, conference NATs).
 * The HTML pages have their own anti-abuse throttling but it's measured
 * in thousands per hour, far above what `dot deploy --modable` and
 * `dot mod` plausibly hit per IP. We get the same public/private signal
 * via HTTP status: 200 = public, 404 = private OR missing (GitHub
 * deliberately refuses to disambiguate to avoid leaking private-repo
 * existence). 5xx and other transient failures fall through so the
 * downstream codeload tarball reveals the truth.
 *
 * Throws ModablePreflightError on 404 with the same message as before so
 * existing callers / tests continue to pattern-match on the wording.
 *
 * Note on redirects: `fetch` follows 30x redirects by default, which is the
 * behaviour we want here — GitHub returns 301 → new location for renamed
 * repos, and the codeload tarball download will follow the same rename, so
 * accepting the redirect mirrors the eventual download behaviour.
 */
export async function assertPublicGitHubRepo(url: string, f: typeof fetch = fetch): Promise<void> {
    const ref = parseGitHubRepoUrl(url);
    if (!ref) return;

    let res: Response;
    try {
        res = await f(`https://github.com/${ref.owner}/${ref.repo}`, { method: "HEAD" });
    } catch {
        return; // network error — can't verify, let downstream fail
    }

    if (res.ok) return;

    if (res.status === 404) {
        throw new ModablePreflightError(
            `${ref.owner}/${ref.repo} is private or does not exist — modable apps must use a public repository`,
        );
    }
    // 5xx, 403 anti-abuse, etc. — skip and let the downstream codeload
    // download surface a clearer error if the repo is actually broken.
}

export async function resolveRepositoryUrl(opts: ResolveRepoOptions): Promise<string> {
    const f = opts.fetch ?? fetch;
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
        opts.onLog?.(`using existing origin (${action.url})…`);
        await assertPublicGitHubRepo(action.url, f);
        return action.url;
    }

    await ensureGhInstalled(opts.onLog);
    await ensureGhAuthed();

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
