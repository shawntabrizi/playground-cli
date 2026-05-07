import { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { getGateway, fetchJson } from "@polkadot-apps/bulletin";
import { Mark, Hint, COLOR } from "../../utils/ui/theme/index.js";

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
    const viewH = Math.max((stdout?.rows ?? 24) - 6, 5);

    const [apps, setApps] = useState<AppEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [cursor, setCursor] = useState(0);
    const [scroll, setScroll] = useState(0);
    const [fetching, setFetching] = useState(true);
    // Offset (in reverse-chronological order) of the next page to request.
    // Contract's `getApps(start, count)` treats `start` as a REVERSE offset —
    // `start=0` returns the newest batch, and the next page resumes at
    // `start + scanned` (NOT `start + count`). With visibility filtering the
    // contract may walk more storage slots than it returns entries for —
    // `scanned` is how far it advanced; using `count` would re-scan the
    // already-walked region and yield duplicates / never reach the end.
    // `null` = no more pages.
    const nextStart = useRef<number | null>(0);

    const gateway = getGateway("paseo");

    const loadBatch = useCallback(
        async (start: number) => {
            setFetching(true);

            const res = await registry.getApps.query(start, BATCH);
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
                    const meta = await fetchJson<Record<string, string>>(cid, gateway);
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

    useInput((input, key) => {
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
        if (key.return && filtered.length > 0) onSelect(filtered[cursor]);
        if (input === "q") onCancel?.();
    });

    const visible = filtered.slice(scroll, scroll + viewH);
    const descW = Math.max((stdout?.columns ?? 80) - COL.num - COL.domain - COL.name - 10, 10);

    return (
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
        </Box>
    );
}
