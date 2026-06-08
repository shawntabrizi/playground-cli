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

/**
 * Quest manifest loader for the `playground mod` quest picker.
 *
 * Quest tracks ship a `quests.json` at the repo root describing the tutorial
 * steps a learner can follow on `main`. The manifest is purely informational
 * from the CLI's point of view: the picker displays it before the existing
 * download flow runs untouched. We fetch the manifest via
 * `raw.githubusercontent.com` (CDN, no `api.github.com` rate-limit cost) so
 * the lookup stays cheap on hackathon WiFi where the anonymous 60/hr quota
 * is shared across the venue.
 *
 * RevX-importable — no React/Ink imports.
 */

import type { GitHubRepoRef } from "./source.js";

export interface QuestEntry {
    id: string;
    title: string;
    difficulty?: number;
    estimated_minutes?: number;
    depends_on?: string[];
    required_tools?: string[];
    ai_skill_hints?: string[];
    teaches?: string[];
    summary?: string;
    acceptance?: string[];
}

export interface QuestsManifest {
    schema_version: number;
    track_id: string;
    title?: string;
    description?: string;
    quests: QuestEntry[];
}

interface FetchOpts {
    fetch?: typeof fetch;
    /**
     * Branch to read `quests.json` from. Defaults to `main`. The mod flow
     * resolves the app's real default branch from metadata (repos default to
     * `master`/`develop` too); thread it through so a quest track on a
     * non-`main` default isn't silently invisible.
     */
    branch?: string;
    /**
     * Abort the fetch after this many ms so the picker never hangs on the
     * "fetching…" spinner on flaky WiFi — a timeout is treated as "not a
     * quest track" and the existing clone flow proceeds untouched.
     */
    timeoutMs?: number;
}

const RAW_HOST = "https://raw.githubusercontent.com";
const DEFAULT_TIMEOUT_MS = 8_000;

export class QuestNotFoundError extends Error {}

/**
 * Fetch and parse `quests.json` from a public GitHub repo. Reads the `main`
 * branch unless `opts.branch` overrides it. Returns `null` when the file is
 * absent (404) so callers can distinguish "not a quest track" from a
 * transport/parse failure.
 */
export async function fetchQuestsManifest(
    ref: GitHubRepoRef,
    opts: FetchOpts = {},
): Promise<QuestsManifest | null> {
    const f = opts.fetch ?? fetch;
    const branch = opts.branch ?? "main";
    const url = `${RAW_HOST}/${ref.owner}/${ref.repo}/${branch}/quests.json`;
    const res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    if (res.status === 404) return null;
    if (!res.ok) {
        throw new Error(`Failed to fetch quests.json from ${url}: ${res.status} ${res.statusText}`);
    }
    let body: unknown;
    try {
        body = await res.json();
    } catch {
        throw new Error(`quests.json at ${url} is not valid JSON`);
    }
    return parseQuestsManifest(body);
}

export function parseQuestsManifest(body: unknown): QuestsManifest {
    if (!body || typeof body !== "object") {
        throw new Error("quests.json: expected an object at the top level");
    }
    const obj = body as Record<string, unknown>;
    if (typeof obj.track_id !== "string" || obj.track_id.length === 0) {
        throw new Error("quests.json: missing or invalid `track_id`");
    }
    if (!Array.isArray(obj.quests)) {
        throw new Error("quests.json: missing or invalid `quests` array");
    }
    const quests: QuestEntry[] = obj.quests.map((q, i) => parseQuest(q, i));
    return {
        schema_version: typeof obj.schema_version === "number" ? obj.schema_version : 1,
        track_id: obj.track_id,
        title: typeof obj.title === "string" ? obj.title : undefined,
        description: typeof obj.description === "string" ? obj.description : undefined,
        quests,
    };
}

function parseQuest(raw: unknown, index: number): QuestEntry {
    if (!raw || typeof raw !== "object") {
        throw new Error(`quests.json: quests[${index}] must be an object`);
    }
    const q = raw as Record<string, unknown>;
    if (typeof q.id !== "string" || q.id.length === 0) {
        throw new Error(`quests.json: quests[${index}].id must be a non-empty string`);
    }
    if (typeof q.title !== "string" || q.title.length === 0) {
        throw new Error(`quests.json: quests[${index}].title must be a non-empty string`);
    }
    return {
        id: q.id,
        title: q.title,
        difficulty: typeof q.difficulty === "number" ? q.difficulty : undefined,
        estimated_minutes:
            typeof q.estimated_minutes === "number" ? q.estimated_minutes : undefined,
        depends_on: stringArray(q.depends_on),
        required_tools: stringArray(q.required_tools),
        ai_skill_hints: stringArray(q.ai_skill_hints),
        teaches: stringArray(q.teaches),
        summary: typeof q.summary === "string" ? q.summary : undefined,
        acceptance: stringArray(q.acceptance),
    };
}

function stringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    if (!value.every((v) => typeof v === "string")) return undefined;
    return value as string[];
}

export function findQuest(manifest: QuestsManifest, questId: string): QuestEntry {
    const quest = manifest.quests.find((q) => q.id === questId);
    if (!quest) {
        const available = manifest.quests.map((q) => q.id).join(", ") || "(none)";
        throw new QuestNotFoundError(
            `Quest "${questId}" not found in track "${manifest.track_id}". Available: ${available}`,
        );
    }
    return quest;
}
