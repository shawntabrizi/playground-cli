/**
 * GitHub-only source acquisition for `dot mod`.
 *
 * Downloads a public repo's source via `codeload.github.com` (no auth, no
 * git binary needed) and extracts into a target directory. RevX-importable
 * — no React/Ink imports.
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { extract } from "tar";

export interface GitHubRepoRef {
    owner: string;
    repo: string;
}

export function parseGitHubRepoUrl(url: string): GitHubRepoRef | null {
    if (!url) return null;
    const trimmed = url
        .trim()
        .replace(/\.git$/, "")
        .replace(/\/$/, "");
    const m = trimmed.match(/^(?:https?:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+)$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
}

interface FetchOpts {
    fetch?: typeof fetch;
}

export interface DownloadOpts {
    owner: string;
    repo: string;
    branch: string;
    targetDir: string;
}

export async function downloadGitHubTarball(
    opts: DownloadOpts,
    fetchOpts: FetchOpts = {},
): Promise<void> {
    if (existsSync(opts.targetDir) && readdirSync(opts.targetDir).length > 0) {
        throw new Error(`Directory "${opts.targetDir}" already exists`);
    }
    mkdirSync(opts.targetDir, { recursive: true });

    const f = fetchOpts.fetch ?? fetch;
    const url = `https://codeload.github.com/${opts.owner}/${opts.repo}/tar.gz/refs/heads/${opts.branch}`;
    const res = await f(url);
    if (!res.ok || !res.body) {
        throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`);
    }

    const nodeStream = Readable.fromWeb(res.body as unknown as import("stream/web").ReadableStream);
    // `pipeline` rejects on any stream error and auto-destroys every stream
    // in the chain on failure — so a network drop, a corrupted gzip stream,
    // or a tar parse error all propagate cleanly without leaking the open
    // socket or buffered chunks. Hand-rolled `.pipe()` chains miss this:
    // attaching `.on("error")` to only the last stream lets an upstream
    // error bubble up as `unhandledRejection` while the promise hangs.
    await pipeline(nodeStream, createGunzip(), extract({ cwd: opts.targetDir, strip: 1 }));
}
