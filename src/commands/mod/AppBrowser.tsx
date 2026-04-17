import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { getGateway, fetchJson } from "@polkadot-apps/bulletin";
import { Spinner } from "../../utils/ui/index.js";

export interface AppEntry {
    domain: string;
    name: string | null;
    description: string | null;
    repository: string | null;
}

interface Props {
    registry: any;
    onSelect: (app: AppEntry) => void;
}

const BATCH = 10;
const COL = { num: 5, domain: 33, name: 37 };

function pad(s: string, w: number): string {
    return s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w);
}

export function AppBrowser({ registry, onSelect }: Props) {
    const { stdout } = useStdout();
    const viewH = Math.max((stdout?.rows ?? 24) - 6, 5);

    const [apps, setApps] = useState<AppEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [cursor, setCursor] = useState(0);
    const [scroll, setScroll] = useState(0);
    const [fetching, setFetching] = useState(true);
    const nextIdx = useRef<number | null>(null);

    const gateway = getGateway("paseo");

    const loadBatch = useCallback(
        async (startIdx: number) => {
            setFetching(true);
            const indices = [];
            for (let i = startIdx; i > startIdx - BATCH && i >= 0; i--) indices.push(i);

            // Track where next batch should start
            const lowestQueried = Math.min(...indices);
            nextIdx.current = lowestQueried > 0 ? lowestQueried - 1 : null;

            // Fetch domains in parallel
            const results = await Promise.all(
                indices.map(async (i) => {
                    const res = await registry.getDomainAt.query(i);
                    return res.value.isSome ? (res.value.value as string) : null;
                }),
            );

            const entries: AppEntry[] = results
                .filter((d): d is string => d !== null)
                .map((domain) => ({ domain, name: null, description: null, repository: null }));

            setApps((prev) => [...prev, ...entries]);
            setFetching(false);

            // Fetch metadata in background, update each entry as it arrives
            await Promise.allSettled(
                entries.map(async (entry) => {
                    const metaRes = await registry.getMetadataUri.query(entry.domain);
                    const cid = metaRes.value.isSome ? (metaRes.value.value as string) : null;
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
                                  }
                                : a,
                        ),
                    );
                }),
            );
        },
        [registry, gateway],
    );

    // Initial load
    useEffect(() => {
        (async () => {
            const res = await registry.getAppCount.query();
            const count = res.value as number;
            setTotal(count);
            if (count > 0) await loadBatch(count - 1);
        })();
    }, []);

    // Auto-load when cursor nears end
    useEffect(() => {
        if (cursor >= apps.length - 3 && nextIdx.current !== null && !fetching) {
            loadBatch(nextIdx.current);
        }
    }, [cursor, apps.length, fetching]);

    // Keyboard
    useInput((input, key) => {
        if (key.upArrow && cursor > 0) {
            const next = cursor - 1;
            setCursor(next);
            if (next < scroll) setScroll(next);
        }
        if (key.downArrow && cursor < apps.length - 1) {
            const next = cursor + 1;
            setCursor(next);
            if (next >= scroll + viewH) setScroll(next - viewH + 1);
        }
        if (key.return && apps.length > 0) onSelect(apps[cursor]);
        if (input === "q") process.exit(0);
    });

    const visible = apps.slice(scroll, scroll + viewH);
    const descW = Math.max((stdout?.columns ?? 80) - COL.num - COL.domain - COL.name - 10, 10);

    return (
        <Box flexDirection="column">
            <Box>
                <Text dimColor>
                    {pad(" #", COL.num)}│ {pad("Domain", COL.domain)}│ {pad("Name", COL.name)}│{" "}
                    Description
                </Text>
            </Box>
            <Box>
                <Text dimColor>
                    {"─".repeat(COL.num)}┼{"─".repeat(COL.domain + 1)}┼{"─".repeat(COL.name + 1)}┼
                    {"─".repeat(descW + 1)}
                </Text>
            </Box>

            {visible.map((app, i) => {
                const idx = scroll + i;
                const sel = idx === cursor;
                const num = sel
                    ? `>${String(idx + 1).padStart(COL.num - 1)}`
                    : ` ${String(idx + 1).padStart(COL.num - 1)}`;
                return (
                    <Box key={idx}>
                        <Text bold={sel} color={sel ? "cyan" : undefined}>
                            {num}│ {pad(app.domain, COL.domain)}│{" "}
                            {pad(app.name ?? (app.name === null ? "…" : "—"), COL.name)}│{" "}
                            {pad(app.description ?? "", descW)}
                        </Text>
                    </Box>
                );
            })}

            {fetching && (
                <Box gap={1}>
                    <Spinner />
                    <Text dimColor>Loading apps...</Text>
                </Box>
            )}
            <Box marginTop={fetching ? 0 : 1}>
                <Text dimColor>
                    ↑↓ navigate ⏎ select q quit ({apps.length}/{total})
                </Text>
            </Box>
        </Box>
    );
}
