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

export function Section({
    title,
    children,
    gapBelow = true,
}: {
    title?: string;
    children: React.ReactNode;
    gapBelow?: boolean;
}) {
    return (
        <Box flexDirection="column" marginBottom={gapBelow ? 1 : 0}>
            {title && (
                <Box paddingLeft={LAYOUT.leftMargin} marginBottom={1}>
                    <Text bold>{title}</Text>
                </Box>
            )}
            {children}
        </Box>
    );
}
