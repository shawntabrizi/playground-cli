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

import { Box, Text } from "ink";
import { LAYOUT } from "./tokens.js";

export interface LogTailProps {
    /** Most-recent-last log lines; undersized arrays are padded with blanks. */
    lines: string[];
    height: number;
}

/**
 * Fixed-height viewport of dim log lines. Used by step runners so a noisy
 * install stream doesn't push the rest of the screen around.
 *
 * This is a pure renderer — coalescing / throttling is the caller's job
 * (see RunningStage.queueInfo for the 10 Hz pattern we rely on to keep
 * setState pressure bounded on high-rate streams).
 */
export function LogTail({ lines, height }: LogTailProps) {
    return (
        <Box flexDirection="column" paddingLeft={LAYOUT.leftMargin + 2} height={height}>
            {Array.from({ length: height }, (_, i) => (
                <Text key={i} dimColor>
                    {lines[i] ?? " "}
                </Text>
            ))}
        </Box>
    );
}
