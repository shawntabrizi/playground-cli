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

import { describe, it, expect } from "vitest";
import {
    fetchQuestsManifest,
    findQuest,
    parseQuestsManifest,
    QuestNotFoundError,
} from "./quests.js";

const validManifest = {
    schema_version: 1,
    track_id: "rock-paper-scissors",
    title: "Rock Paper Scissors",
    description: "Progress from local to on-chain.",
    quests: [
        {
            id: "level-1",
            title: "Local Challenger",
            difficulty: 1,
            estimated_minutes: 15,
            required_tools: ["dot-cli"],
            ai_skill_hints: [".claude/skills/level-1.md"],
            teaches: ["Bulletin hosting"],
            summary: "Play vs. the computer.",
            acceptance: ["App deployed via dot deploy"],
        },
        {
            id: "level-2",
            title: "On-Chain Record",
            difficulty: 2,
            depends_on: ["level-1"],
        },
    ],
};

describe("parseQuestsManifest", () => {
    it("parses a valid manifest", () => {
        const m = parseQuestsManifest(validManifest);
        expect(m.track_id).toBe("rock-paper-scissors");
        expect(m.title).toBe("Rock Paper Scissors");
        expect(m.quests).toHaveLength(2);
        expect(m.quests[0].id).toBe("level-1");
        expect(m.quests[0].difficulty).toBe(1);
        expect(m.quests[1].depends_on).toEqual(["level-1"]);
    });

    it("defaults schema_version to 1 when missing", () => {
        const m = parseQuestsManifest({ ...validManifest, schema_version: undefined });
        expect(m.schema_version).toBe(1);
    });

    it("rejects a non-object body", () => {
        expect(() => parseQuestsManifest(null)).toThrow(/expected an object/i);
        expect(() => parseQuestsManifest("nope")).toThrow(/expected an object/i);
    });

    it("rejects missing track_id", () => {
        expect(() => parseQuestsManifest({ quests: [] })).toThrow(/track_id/);
    });

    it("rejects missing quests array", () => {
        expect(() => parseQuestsManifest({ track_id: "x" })).toThrow(/quests/);
    });

    it("rejects a quest without id", () => {
        expect(() =>
            parseQuestsManifest({
                track_id: "x",
                quests: [{ title: "a" }],
            }),
        ).toThrow(/quests\[0\]\.id/);
    });

    it("rejects a quest without title", () => {
        expect(() =>
            parseQuestsManifest({
                track_id: "x",
                quests: [{ id: "a" }],
            }),
        ).toThrow(/quests\[0\]\.title/);
    });

    it("ignores ai_skill_hints when not an array of strings", () => {
        const m = parseQuestsManifest({
            track_id: "x",
            quests: [{ id: "a", title: "A", ai_skill_hints: [1, 2] }],
        });
        expect(m.quests[0].ai_skill_hints).toBeUndefined();
    });
});

describe("findQuest", () => {
    const m = parseQuestsManifest(validManifest);

    it("returns the matching quest", () => {
        expect(findQuest(m, "level-2").title).toBe("On-Chain Record");
    });

    it("throws QuestNotFoundError listing available ids", () => {
        try {
            findQuest(m, "level-99");
            expect.fail("should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(QuestNotFoundError);
            expect((err as Error).message).toMatch(/level-1, level-2/);
        }
    });
});

describe("fetchQuestsManifest", () => {
    it("hits raw.githubusercontent.com on main", async () => {
        let seen: string | null = null;
        const fetchImpl: typeof fetch = async (url) => {
            seen = String(url);
            return new Response(JSON.stringify(validManifest), { status: 200 });
        };
        const m = await fetchQuestsManifest(
            { owner: "paritytech", repo: "Rock-Paper-Scissors" },
            { fetch: fetchImpl },
        );
        expect(seen).toBe(
            "https://raw.githubusercontent.com/paritytech/Rock-Paper-Scissors/main/quests.json",
        );
        expect(m?.track_id).toBe("rock-paper-scissors");
    });

    it("returns null for 404", async () => {
        const fetchImpl: typeof fetch = async () => new Response("not found", { status: 404 });
        const m = await fetchQuestsManifest({ owner: "x", repo: "y" }, { fetch: fetchImpl });
        expect(m).toBeNull();
    });

    it("throws on non-2xx, non-404", async () => {
        const fetchImpl: typeof fetch = async () => new Response("nope", { status: 500 });
        await expect(
            fetchQuestsManifest({ owner: "x", repo: "y" }, { fetch: fetchImpl }),
        ).rejects.toThrow(/500/);
    });

    it("throws when the response is not JSON", async () => {
        const fetchImpl: typeof fetch = async () =>
            new Response("not-json", {
                status: 200,
                headers: { "content-type": "text/plain" },
            });
        await expect(
            fetchQuestsManifest({ owner: "x", repo: "y" }, { fetch: fetchImpl }),
        ).rejects.toThrow(/not valid JSON/);
    });
});
