import { useState, useEffect } from "react";
import { Text } from "ink";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

export function Spinner({ tick: externalTick }: { tick?: number } = {}) {
    const [internalTick, setInternalTick] = useState(0);

    useEffect(() => {
        if (externalTick !== undefined) return;
        const id = setInterval(() => setInternalTick((t) => t + 1), SPINNER_INTERVAL_MS);
        return () => clearInterval(id);
    }, [externalTick]);

    const tick = externalTick ?? internalTick;
    return <Text color="yellow">{SPINNER_FRAMES[tick % SPINNER_FRAMES.length]}</Text>;
}

export function Done() {
    return <Text color="green">✔</Text>;
}

export function Failed() {
    return <Text color="red">✖</Text>;
}

export function Warning() {
    return <Text color="yellow">!</Text>;
}
