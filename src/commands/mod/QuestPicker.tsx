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

import { useCallback, useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { COLOR, Hint, Mark } from "../../utils/ui/theme/index.js";
import type { GitHubRepoRef } from "../../utils/mod/source.js";
import {
    fetchQuestsManifest,
    type QuestEntry,
    type QuestsManifest,
} from "../../utils/mod/quests.js";
import { pad, formatDifficulty } from "./questPickerFormat.js";

interface Props {
    repoRef: GitHubRepoRef;
    /** Branch to read `quests.json` from (defaults to `main`). */
    branch?: string;
    /** Resolves once the user is done browsing (Start tutorial or skip). */
    onDone: () => void;
    /** User cancelled the whole flow. */
    onCancel: () => void;
}

const COL = { num: 5, id: 16, title: 32, difficulty: 12 };

export function QuestPicker({ repoRef, branch, onDone, onCancel }: Props) {
    const { stdout } = useStdout();
    const viewH = Math.max((stdout?.rows ?? 24) - 10, 5);

    const [manifest, setManifest] = useState<QuestsManifest | null>(null);
    const [fetching, setFetching] = useState(true);
    const [cursor, setCursor] = useState(0);
    const [scroll, setScroll] = useState(0);

    const load = useCallback(async () => {
        try {
            const m = await fetchQuestsManifest(repoRef, { branch });
            // Skip the picker silently — and let the existing download flow
            // run — when there's no `quests.json` (not a quest track) OR the
            // manifest defines zero quests. The empty case must behave exactly
            // like the absent one; rendering a quest-less picker would dead-end
            // the whole `mod` (no "Start tutorial" button, only `q` to quit).
            if (!m || m.quests.length === 0) {
                onDone();
                return;
            }
            setManifest(m);
        } catch {
            // Malformed manifest or transient error — same fall-through.
            onDone();
        } finally {
            setFetching(false);
        }
    }, [repoRef, branch, onDone]);

    useEffect(() => {
        load();
    }, [load]);

    const quests: QuestEntry[] = manifest?.quests ?? [];

    // Cursor moves through quests AND a trailing "Start tutorial" button.
    // Quest rows are read-only browsing — only the button has an Enter action.
    const buttonIndex = quests.length;
    const itemCount = quests.length + 1;

    useInput((input, key) => {
        if (fetching || !manifest) {
            if (input === "q") onCancel();
            return;
        }
        if (key.upArrow && cursor > 0) {
            const next = cursor - 1;
            setCursor(next);
            if (next < scroll) setScroll(next);
        }
        if (key.downArrow && cursor < itemCount - 1) {
            const next = cursor + 1;
            setCursor(next);
            if (next >= scroll + viewH) setScroll(next - viewH + 1);
        }
        if (key.return && cursor === buttonIndex && quests.length > 0) {
            onDone();
        }
        if (input === "q") onCancel();
    });

    if (fetching) {
        return (
            <Box gap={1} paddingLeft={2}>
                <Mark kind="run" />
                <Text dimColor>
                    fetching quests.json from github.com/{repoRef.owner}/{repoRef.repo} (main)…
                </Text>
            </Box>
        );
    }

    if (!manifest || quests.length === 0) {
        return (
            <Box flexDirection="column" paddingLeft={2}>
                <Text dimColor>This track has no quests defined.</Text>
                <Box marginTop={1}>
                    <Hint>q quit</Hint>
                </Box>
            </Box>
        );
    }

    const visible = quests.slice(scroll, scroll + viewH);
    const notesCol = Math.max(
        (stdout?.columns ?? 80) - COL.num - COL.id - COL.title - COL.difficulty - 12,
        10,
    );
    const focusedQuest = cursor < quests.length ? quests[cursor] : null;
    const buttonFocused = cursor === buttonIndex;

    return (
        <Box flexDirection="column" paddingLeft={2}>
            <Box marginBottom={1}>
                <Text>
                    Quest track:{" "}
                    <Text bold color={COLOR.accent}>
                        {manifest.title ?? manifest.track_id}
                    </Text>
                </Text>
            </Box>
            <Box>
                <Text dimColor>
                    {`${pad(" #", COL.num)}  ${pad("id", COL.id)}  ${pad("title", COL.title)}  ${pad(
                        "difficulty",
                        COL.difficulty,
                    )}  notes`}
                </Text>
            </Box>
            <Box>
                <Text dimColor>
                    {"─".repeat(COL.num + COL.id + COL.title + COL.difficulty + notesCol + 12)}
                </Text>
            </Box>

            {visible.map((q, i) => {
                const idx = scroll + i;
                const sel = idx === cursor;
                const num = sel
                    ? `›${String(idx + 1).padStart(COL.num - 1)}`
                    : ` ${String(idx + 1).padStart(COL.num - 1)}`;
                const diff = formatDifficulty(q.difficulty);
                const notes =
                    q.depends_on && q.depends_on.length > 0
                        ? `needs: ${q.depends_on.join(", ")}`
                        : "";
                return (
                    <Box key={q.id}>
                        <Text bold={sel} color={sel ? COLOR.accent : undefined}>
                            {`${num}  ${pad(q.id, COL.id)}  ${pad(q.title, COL.title)}  ${pad(
                                diff,
                                COL.difficulty,
                            )}  ${pad(notes, notesCol)}`}
                        </Text>
                    </Box>
                );
            })}

            {focusedQuest?.summary && (
                <Box marginTop={1} paddingLeft={0}>
                    <Text dimColor>↳ {focusedQuest.summary}</Text>
                </Box>
            )}

            <Box marginTop={1}>
                <Text bold={buttonFocused} color={buttonFocused ? COLOR.accent : undefined}>
                    {buttonFocused ? "› [ Start tutorial → ]" : "  [ Start tutorial → ]"}
                </Text>
            </Box>

            <Box marginTop={1}>
                <Hint>↑↓ navigate · ⏎ start tutorial · q quit</Hint>
            </Box>
        </Box>
    );
}
