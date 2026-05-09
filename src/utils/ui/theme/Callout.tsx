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
import { COLOR, LAYOUT } from "./tokens.js";

type CalloutTone = "accent" | "warning" | "danger" | "success";

/**
 * Light-touch bordered panel for moments that must interrupt scanning —
 * e.g. the "check your phone" sign-in prompt during a deploy. Use sparingly;
 * overusing this reverts the aesthetic to card-soup.
 */
export function Callout({
    tone = "accent",
    title,
    children,
}: {
    tone?: CalloutTone;
    title?: string;
    children: React.ReactNode;
}) {
    const color = toneToColor(tone);
    return (
        <Box
            marginLeft={LAYOUT.leftMargin}
            marginTop={1}
            marginBottom={1}
            borderStyle="round"
            borderColor={color}
            paddingX={1}
            flexDirection="column"
        >
            {title && (
                <Text color={color} bold>
                    {title}
                </Text>
            )}
            {children}
        </Box>
    );
}

function toneToColor(tone: CalloutTone) {
    switch (tone) {
        case "danger":
            return COLOR.danger;
        case "warning":
            return COLOR.warning;
        case "success":
            return COLOR.success;
        default:
            return COLOR.accent;
    }
}
