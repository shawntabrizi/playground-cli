/**
 * `dot deploy --moddable` preflight: resolves the public GitHub URL we'll
 * record in the Bulletin metadata.
 *
 * The contract is intentionally narrow: the user is responsible for setting
 * up a public GitHub `origin` themselves. `dot` never shells out to `gh` and
 * never creates a repository. If `origin` is missing or points anywhere
 * other than a public GitHub URL, the deploy fails with an actionable
 * message.
 */

import { execFileSync } from "node:child_process";
import { commandExists, TOOL_STEPS } from "../toolchain.js";
import { parseGitHubRepoUrl } from "../mod/source.js";

export class ModdablePreflightError extends Error {}

export async function ensureGitInstalled(onLog?: (line: string) => void): Promise<void> {
    if (await commandExists("git")) return;
    const step = TOOL_STEPS.find((s) => s.name === "git");
    if (!step) throw new ModdablePreflightError("internal: git step missing from TOOL_STEPS");
    await step.install(onLog);
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
    onLog?: (line: string) => void;
    fetch?: typeof fetch;
}

const NO_ORIGIN_MESSAGE =
    "--moddable: no GitHub origin configured. Create a public GitHub repository, " +
    "commit and push your code, set it as `origin` (e.g. `git remote add origin " +
    "https://github.com/<user>/<repo>` followed by `git push -u origin main`), " +
    "and re-run. Pass --no-moddable to skip publishing source.";

/**
 * Verifies that a repository URL is a publicly accessible GitHub repo.
 *
 * - Non-GitHub URLs (GitLab, Bitbucket, self-hosted, anything `parseGitHubRepoUrl`
 *   refuses) hard-fail. `dot mod` only fetches from `codeload.github.com`, so a
 *   non-GitHub URL would publish a "moddable" app that nobody can actually mod.
 * - For GitHub URLs we issue a `HEAD https://github.com/{owner}/{repo}` against
 *   the regular HTML page rather than `api.github.com/repos/{owner}/{repo}` —
 *   the HTML surface is NOT subject to the 60/hour anonymous-IP API rate limit
 *   that gets exhausted on shared networks (hackathon WiFi, conference NATs).
 *   We get the same public/private signal via HTTP status: 200 = public, 404 =
 *   private OR missing (GitHub deliberately refuses to disambiguate to avoid
 *   leaking private-repo existence). 5xx and other transient failures fall
 *   through so the downstream codeload tarball reveals the truth.
 *
 * Note on redirects: `fetch` follows 30x redirects by default, which is the
 * behaviour we want here — GitHub returns 301 → new location for renamed
 * repos, and the codeload tarball download will follow the same rename, so
 * accepting the redirect mirrors the eventual download behaviour.
 */
export async function assertPublicGitHubRepo(url: string, f: typeof fetch = fetch): Promise<void> {
    const ref = parseGitHubRepoUrl(url);
    if (!ref) {
        throw new ModdablePreflightError(
            `moddable apps must use a public GitHub repository (got: ${url})`,
        );
    }

    let res: Response;
    try {
        res = await f(`https://github.com/${ref.owner}/${ref.repo}`, { method: "HEAD" });
    } catch {
        return; // network error — can't verify, let downstream fail
    }

    if (res.ok) return;

    if (res.status === 404) {
        throw new ModdablePreflightError(
            `${ref.owner}/${ref.repo} is private or does not exist — moddable apps must use a public repository`,
        );
    }
    // 5xx, 403 anti-abuse, etc. — skip and let the downstream codeload
    // download surface a clearer error if the repo is actually broken.
}

export async function resolveRepositoryUrl(opts: ResolveRepoOptions): Promise<string> {
    const f = opts.fetch ?? fetch;
    const origin = readOrigin(opts.cwd);
    if (!origin) throw new ModdablePreflightError(NO_ORIGIN_MESSAGE);
    const normalised = origin.replace(/\.git$/, "");
    opts.onLog?.(`using existing origin (${normalised})…`);
    await assertPublicGitHubRepo(normalised, f);
    return normalised;
}
