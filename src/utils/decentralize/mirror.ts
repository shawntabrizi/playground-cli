// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface MirrorOptions {
    /** http(s) URL to mirror. Other schemes are rejected. */
    url: string;
    /** Optional callback for streaming wget output, one line at a time. */
    onLine?: (line: string) => void;
    /**
     * @internal Override the binary that gets spawned. Tests use this to point
     * at a deliberately-missing path (to exercise the `WgetMissingError`
     * branch) or at `/usr/bin/true` (to exercise the empty-mirror branch
     * without making a network request). Production callers leave this unset.
     */
    wgetBinary?: string;
}

export interface MirrorResult {
    /** Absolute path to the temp directory wget wrote into. Owned by the
     *  caller — passed to `rm -rf` once the upload finishes. */
    directory: string;
    /**
     * Directory to actually upload — the parent of the shallowest
     * `index.html`. Equals `directory` when the URL has no path (`/`); for
     * URLs like `https://host/foo/bar/`, wget writes to `directory/foo/bar/`
     * because `--no-host-directories` strips only the hostname segment, so
     * we resolve down to the actual document root before handing off.
     */
    uploadRoot: string;
    /** Number of files written under `directory` (NOT `uploadRoot`). */
    fileCount: number;
}

export class WgetMissingError extends Error {
    constructor() {
        super(
            "wget is required to mirror sites but was not found on PATH. " +
                "Install it via `brew install wget` (macOS) or your package manager.",
        );
        this.name = "WgetMissingError";
    }
}

export class InvalidSiteUrlError extends Error {
    constructor(url: string, reason: string) {
        super(`Invalid --site URL "${url}": ${reason}`);
        this.name = "InvalidSiteUrlError";
    }
}

/**
 * Normalise a user-typed site URL into the canonical `http(s)://…` form that
 * `wget` will accept. Exported so the TUI and unit tests can validate
 * candidate input without going through the whole mirror pipeline.
 */
export function validateUrl(input: string): string {
    let parsed: URL;
    try {
        parsed = new URL(input);
    } catch {
        // Allow shorthand like "shawntabrizi.github.io" by adding https://.
        try {
            parsed = new URL(`https://${input}`);
        } catch {
            throw new InvalidSiteUrlError(input, "not a parseable URL");
        }
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new InvalidSiteUrlError(input, `unsupported scheme ${parsed.protocol}`);
    }
    return parsed.toString();
}

/**
 * BFS for the directory containing the shallowest `index.html`. Used as
 * the upload root so Bulletin's renderer always sees `index.html` at the
 * top level regardless of URL path depth.
 *
 * Root cause this guards against: `wget --no-host-directories` strips only
 * the hostname segment, so `https://host/foo/bar/` writes
 * `<tmp>/foo/bar/index.html` — not `<tmp>/index.html`. Uploading the wget
 * directory verbatim would put a directory at the IPFS root with no
 * document, producing "Archive missing index.html" at view time.
 *
 * Returns `null` when no `index.html` exists anywhere in the tree (e.g.
 * dynamic sites that need server-side rendering); callers should surface
 * that to the user rather than upload an unrenderable archive.
 */
export function findIndexHtmlRoot(rootDir: string): string | null {
    const queue: string[] = [rootDir];
    while (queue.length > 0) {
        const dir = queue.shift()!;
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            continue;
        }
        if (entries.includes("index.html")) return dir;
        for (const entry of entries) {
            const full = join(dir, entry);
            try {
                if (statSync(full).isDirectory()) queue.push(full);
            } catch {
                // dangling symlink / permission error — skip
            }
        }
    }
    return null;
}

/**
 * Recursive file count under `root`. Used after a wget run to detect the
 * empty-mirror case (success exit, zero files). Exported for tests.
 */
export function countFiles(root: string): number {
    let count = 0;
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            const st = statSync(full);
            if (st.isDirectory()) walk(full);
            else if (st.isFile()) count++;
        }
    };
    try {
        walk(root);
    } catch {
        // ignore — caller validates non-empty via the returned count.
    }
    return count;
}

/**
 * Mirror a live HTTP(S) static site into a fresh temp directory using `wget`.
 *
 * Flags chosen for "useful default for static sites":
 *   --mirror              recursive download + timestamping + infinite depth
 *   --convert-links       rewrite absolute → relative so the local copy renders
 *   --adjust-extension    add .html so links resolve from a flat filesystem
 *   --page-requisites     pull CSS/JS/images that pages reference
 *   --no-parent           don't climb above the URL's directory
 *   --no-host-directories drop the hostname segment from the output path
 *   --no-verbose          one progress line per file; not silent so onLine works
 *
 * URL safety: passed as a separate execve argument, never spliced into a shell
 * string, so a malicious URL cannot inject other flags or shell metacharacters.
 */
export async function mirrorSite(options: MirrorOptions): Promise<MirrorResult> {
    const url = validateUrl(options.url);
    const directory = mkdtempSync(join(tmpdir(), "dot-decentralize-"));

    const args = [
        "--mirror",
        "--convert-links",
        "--adjust-extension",
        "--page-requisites",
        "--no-parent",
        "--no-host-directories",
        "--no-verbose",
        `--directory-prefix=${directory}`,
        url,
    ];

    await new Promise<void>((resolve, reject) => {
        const proc = spawn(options.wgetBinary ?? "wget", args, {
            stdio: ["ignore", "pipe", "pipe"],
        });

        proc.on("error", (err: NodeJS.ErrnoException) => {
            if (err.code === "ENOENT") reject(new WgetMissingError());
            else reject(err);
        });

        const forward = (chunk: Buffer) => {
            if (!options.onLine) return;
            for (const line of chunk.toString("utf8").split("\n")) {
                if (line.trim()) options.onLine(line);
            }
        };
        proc.stdout?.on("data", forward);
        proc.stderr?.on("data", forward);

        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`wget failed (exit ${code}) — site may be unreachable`));
        });
    });

    const fileCount = countFiles(directory);
    if (fileCount === 0) {
        throw new Error(
            `wget completed but no files were downloaded from ${url}. The site may be empty or block crawlers.`,
        );
    }
    const uploadRoot = findIndexHtmlRoot(directory);
    if (!uploadRoot) {
        throw new Error(
            `wget downloaded ${fileCount} files from ${url} but none was index.html. ` +
                "Bulletin's viewer needs an index.html at the root — the site may be " +
                "fully client-side-rendered or served from a redirect.",
        );
    }
    return { directory, uploadRoot, fileCount };
}
