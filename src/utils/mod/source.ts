/**
 * GitHub-only source acquisition for `dot mod`.
 *
 * Downloads a public repo's source via `codeload.github.com` (no auth, no
 * git binary needed) and extracts into a target directory. RevX-importable
 * — no React/Ink imports.
 */

export interface GitHubRepoRef {
    owner: string;
    repo: string;
}

export function parseGitHubRepoUrl(url: string): GitHubRepoRef | null {
    if (!url) return null;
    const trimmed = url.trim().replace(/\.git$/, "").replace(/\/$/, "");
    const m = trimmed.match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+)$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
}

interface FetchOpts {
    fetch?: typeof fetch;
}

export async function resolveDefaultBranch(
    ref: GitHubRepoRef,
    opts: FetchOpts = {},
): Promise<string> {
    const f = opts.fetch ?? fetch;
    try {
        const res = await f(`https://api.github.com/repos/${ref.owner}/${ref.repo}`);
        if (res.ok) {
            const body = (await res.json()) as { default_branch?: string };
            if (body.default_branch) return body.default_branch;
        }
    } catch {
        // fall through to the heuristic probes
    }
    for (const candidate of ["main", "master"]) {
        try {
            const probe = await f(`https://github.com/${ref.owner}/${ref.repo}/tree/${candidate}`);
            if (probe.ok) return candidate;
        } catch {
            // try next
        }
    }
    throw new Error(
        `Could not resolve a default branch for ${ref.owner}/${ref.repo} — pin one in metadata.branch`,
    );
}
