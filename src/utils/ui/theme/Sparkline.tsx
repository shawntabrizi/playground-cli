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

import { Text } from "ink";
import { GLYPH } from "./tokens.js";

export interface SparklineProps {
    /** Numeric samples. Non-negative values work best. */
    values: number[];
    /** Target width in characters. Averages buckets when samples exceed width. */
    width?: number;
}

/**
 * One-line bar-chart sparkline built from unicode block fractions.
 * Used on the deploy completion card to show per-chunk upload timings.
 * Pure: no timers, no state, memory is the output string.
 */
export function Sparkline({ values, width = 16 }: SparklineProps) {
    if (values.length === 0) return <Text> </Text>;

    const samples = resample(values, width);
    let min = Infinity;
    let max = -Infinity;
    for (const v of samples) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    // All samples equal → render as mid-height bars, not empty.
    const range = max - min || 1;
    const levels = GLYPH.bars.length;

    const rendered = samples
        .map((v) => {
            const n = Math.round(((v - min) / range) * (levels - 1));
            return GLYPH.bars[Math.max(0, Math.min(levels - 1, n))];
        })
        .join("");

    return <Text>{rendered}</Text>;
}

/** Bucketed average resample. Preserves shape when compressing long inputs. */
function resample(values: number[], target: number): number[] {
    if (values.length <= target) return values.slice();
    const out: number[] = [];
    for (let i = 0; i < target; i++) {
        const start = Math.floor((i * values.length) / target);
        const end = Math.floor(((i + 1) * values.length) / target);
        let sum = 0;
        let n = 0;
        for (let j = start; j < end && j < values.length; j++) {
            sum += values[j];
            n++;
        }
        out.push(n > 0 ? sum / n : 0);
    }
    return out;
}
