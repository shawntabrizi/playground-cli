import { useState, useEffect } from "react";
import { Text } from "ink";
import { COLOR, GLYPH, TIMING } from "./tokens.js";

export type MarkKind = "ok" | "fail" | "warn" | "run" | "idle";

/** Semantic status glyph. Width-normalized to 1 column. */
export function Mark({ kind }: { kind: MarkKind }) {
    switch (kind) {
        case "ok":
            return <Text color={COLOR.success}>{GLYPH.ok}</Text>;
        case "fail":
            return <Text color={COLOR.danger}>{GLYPH.fail}</Text>;
        case "warn":
            return <Text color={COLOR.warning}>{GLYPH.warn}</Text>;
        case "run":
            return <Spinner />;
        case "idle":
            return <Text dimColor>{GLYPH.pending}</Text>;
    }
}

function Spinner() {
    const [tick, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(
            () => setTick((t) => (t + 1) % GLYPH.spinner.length),
            TIMING.spinnerMs,
        );
        return () => clearInterval(id);
    }, []);
    return <Text color={COLOR.warning}>{GLYPH.spinner[tick]}</Text>;
}
