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

import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { Mark, Hint, Callout, COLOR } from "../../utils/ui/theme/index.js";
import { fetchBulletinJson, getBulletinGateway } from "../../utils/bulletinGateway.js";
import { assertPublicGitHubRepo, ModdablePreflightError } from "../../utils/deploy/moddable.js";

import { COMMUNITY_NOTICE_TITLE, COMMUNITY_NOTICE_BODY } from "./communityNotice.js";
import {
    SOURCE_UNAVAILABLE_TITLE,
    sourceUnavailableBody,
    PICK_ANOTHER_APP,
} from "./sourceUnavailable.js";
import { filterModdable, type AppEntry } from "./browserFilter.js";
export type { AppEntry };

interface Props {
    registry: any;
    onSelect: (app: AppEntry) => void;
    onCancel?: () => void;
    moddableOnly?: boolean;
}

const BATCH = 10;
const COL = { num: 5, domain: 33, name: 37 };

function pad(s: string, w: number): string {
    return s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w);
}

export function AppBrowser({ registry, onSelect, onCancel, moddableOnly }: Props) {
    const { stdout } = useStdout();
    // The community-code callout above the list takes ~8 rows (margins,
    // borders, title, wrapped body), on top of the 6 rows of list chrome.
    const viewH = Math.max((stdout?.rows ?? 24) - 14, 5);

    const [apps, setApps] = useState<AppEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [cursor, setCursor] = useState(0);
    const [scroll, setScroll] = useState(0);
    const [fetching, setFetching] = useState(true);
    // A source check is in flight (HEAD against the picked app's GitHub repo).
    const [checking, setChecking] = useState(false);
    // Domain of the app whose repo turned out to be unreachable, or null. The
    // picker stays open and shows a yellow notice so the user picks another.
    const [unavailable, setUnavailable] = useState<string | null>(null);
    // Set when the user quits mid-check so the in-flight verifyAndSelect promise
    // no-ops instead of calling onSelect/setState on an unmounted component.
    const cancelledRef = useRef(false);
    // Offset (in reverse-chronological order) of the next page to request.
    // Contract's `getApps(start, count)` treats `start` as a REVERSE offset —
    // `start=0` returns the newest batch, and the next page resumes at
    // `start + scanned` (NOT `start + count`). With visibility filtering the
    // contract may walk more storage slots than it returns entries for —
    // `scanned` is how far it advanced; using `count` would re-scan the
    // already-walked region and yield duplicates / never reach the end.
    // `null` = no more pages.
    const nextStart = useRef<number | null>(0);

    const gateway = getBulletinGateway();

    const loadBatch = useCallback(
        async (start: number) => {
            setFetching(true);

            const res = await registry.getApps.query(start, BATCH);
            if (!res.success) {
                // Treat a failed registry dry-run as "no apps to show" rather than
                // letting the dispatch-error payload crash the renderer when we
                // tried to dereference `.value.entries`. Surface the underlying
                // shape in telemetry-visible state if useful later; for now keep
                // the picker quiet and stop trying to paginate.
                setTotal(0);
                nextStart.current = null;
                setFetching(false);
                return;
            }
            const rawEntries = res.value.entries as Array<{
                index: number;
                domain: string;
                metadata_uri: string;
                owner: string;
            }>;
            const totalFromResp = res.value.total as number;
            const scannedFromResp = res.value.scanned as number;
            // Always set — React bails on same-value updates.
            setTotal(totalFromResp);

            // Resume from where the contract stopped scanning, not where it
            // would have stopped if it returned a full BATCH. Defensive guard
            // on `scanned > 0` so a misbehaving contract can't trap us in an
            // infinite re-fetch loop.
            const nextOffset = start + scannedFromResp;
            nextStart.current =
                scannedFromResp > 0 && nextOffset < totalFromResp ? nextOffset : null;

            const entries: AppEntry[] = rawEntries.map((e) => ({
                domain: e.domain,
                name: null,
                description: null,
                repository: null,
                branch: null,
                tag: null,
            }));

            setApps((prev) => [...prev, ...entries]);
            setFetching(false);

            // Metadata JSONs still have to be fetched one-at-a-time from
            // the gateway — that's IPFS HTTP, not a chain query. Kick them
            // off in parallel and update each row as it lands.
            await Promise.allSettled(
                rawEntries.map(async (raw, i) => {
                    const entry = entries[i];
                    const cid = raw.metadata_uri;
                    if (!cid) return;
                    const meta = await fetchBulletinJson<Record<string, string>>(cid, gateway);
                    setApps((prev) =>
                        prev.map((a) =>
                            a === entry
                                ? {
                                      ...a,
                                      name: meta.name ?? null,
                                      description: meta.description ?? null,
                                      repository: meta.repository ?? null,
                                      branch: meta.branch ?? null,
                                      tag: meta.tag ?? null,
                                  }
                                : a,
                        ),
                    );
                }),
            );
        },
        [registry, gateway],
    );

    useEffect(() => {
        // `getApps(0, BATCH)` returns the newest batch plus `total`, so we
        // don't need a separate `getAppCount` probe. When the registry is
        // empty, the response still carries `total: 0` — we drop the spinner
        // and leave `nextStart.current` at its initial 0 harmlessly (the
        // scroll-trigger effect guards on `apps.length`, so it won't re-fire).
        loadBatch(0);
    }, [loadBatch]);

    const filtered = filterModdable(apps, Boolean(moddableOnly));

    useEffect(() => {
        if (cursor >= filtered.length - 3 && nextStart.current !== null && !fetching) {
            loadBatch(nextStart.current);
        }
    }, [cursor, filtered.length, fetching, loadBatch]);

    // The picker filters to apps that published a repository URL, but that URL
    // is frozen at deploy time and never re-checked against live GitHub (see
    // sourceUnavailable.ts). Probe ONLY the picked app — one HEAD request, same
    // as the old post-pick check — so a stale/now-private repo is caught before
    // we mount SetupScreen. A 404 keeps the user in the picker with a friendly
    // notice; transient errors fall through to SetupScreen's clearer download
    // failure.
    const verifyAndSelect = useCallback(
        async (app: AppEntry) => {
            if (!app.repository) {
                onSelect(app);
                return;
            }
            setChecking(true);
            setUnavailable(null);
            try {
                await assertPublicGitHubRepo(app.repository);
                if (cancelledRef.current) return;
                onSelect(app);
            } catch (err) {
                if (cancelledRef.current) return;
                if (err instanceof ModdablePreflightError) {
                    setUnavailable(app.domain);
                    setChecking(false);
                } else {
                    onSelect(app);
                }
            }
        },
        [onSelect],
    );

    useInput((input, key) => {
        // `q` quits even while a source check is in flight — set the cancel
        // flag first so the pending verifyAndSelect promise no-ops instead of
        // resolving onSelect/setState against an unmounted component.
        if (input === "q") {
            cancelledRef.current = true;
            onCancel?.();
            return;
        }
        // Otherwise ignore keystrokes during the brief HEAD check so navigation
        // and Enter can't race the in-flight verification.
        if (checking) return;
        if (key.upArrow || key.downArrow) setUnavailable(null);
        if (key.upArrow && cursor > 0) {
            const next = cursor - 1;
            setCursor(next);
            if (next < scroll) setScroll(next);
        }
        if (key.downArrow && cursor < filtered.length - 1) {
            const next = cursor + 1;
            setCursor(next);
            if (next >= scroll + viewH) setScroll(next - viewH + 1);
        }
        if (key.return && filtered.length > 0) void verifyAndSelect(filtered[cursor]);
    });

    const visible = filtered.slice(scroll, scroll + viewH);
    const descW = Math.max((stdout?.columns ?? 80) - COL.num - COL.domain - COL.name - 10, 10);

    return (
        <Box flexDirection="column">
            <Callout tone="warning" title={COMMUNITY_NOTICE_TITLE}>
                <Text>{COMMUNITY_NOTICE_BODY}</Text>
            </Callout>
            <Box flexDirection="column" paddingLeft={2}>
                <Box>
                    <Text dimColor>
                        {`${pad(" #", COL.num)}  ${pad("domain", COL.domain)}  ${pad(
                            "name",
                            COL.name,
                        )}  description`}
                    </Text>
                </Box>
                <Box>
                    <Text dimColor>{"─".repeat(COL.num + COL.domain + COL.name + descW + 6)}</Text>
                </Box>

                {visible.map((app, i) => {
                    const idx = scroll + i;
                    const sel = idx === cursor;
                    const num = sel
                        ? `›${String(idx + 1).padStart(COL.num - 1)}`
                        : ` ${String(idx + 1).padStart(COL.num - 1)}`;
                    return (
                        <Box key={idx}>
                            <Text bold={sel} color={sel ? COLOR.accent : undefined}>
                                {`${num}  ${pad(app.domain, COL.domain)}  ${pad(
                                    app.name ?? (app.name === null ? "…" : "—"),
                                    COL.name,
                                )}  ${pad(app.description ?? "", descW)}`}
                            </Text>
                        </Box>
                    );
                })}

                {fetching && (
                    <Box gap={1} marginTop={1} paddingLeft={0}>
                        <Mark kind="run" />
                        <Text dimColor>loading apps…</Text>
                    </Box>
                )}
                {!fetching && filtered.length === 0 && nextStart.current === null && (
                    <Box marginTop={1}>
                        <Text dimColor>No moddable apps in the registry yet.</Text>
                    </Box>
                )}
                <Box marginTop={fetching ? 0 : 1}>
                    <Hint>{`↑↓ navigate  ·  ⏎ select  ·  q quit  ·  ${
                        moddableOnly
                            ? `(${filtered.length} moddable, ${apps.length}/${total} scanned)`
                            : `(${apps.length}/${total})`
                    }`}</Hint>
                </Box>
                {checking && (
                    <Box gap={1} marginTop={1}>
                        <Mark kind="run" />
                        <Text dimColor>checking source…</Text>
                    </Box>
                )}
            </Box>
            {unavailable && (
                <Callout tone="warning" title={SOURCE_UNAVAILABLE_TITLE}>
                    <Text>{sourceUnavailableBody(unavailable, PICK_ANOTHER_APP)}</Text>
                </Callout>
            )}
        </Box>
    );
}
