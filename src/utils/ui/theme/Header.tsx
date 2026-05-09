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

import React, { useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import { LAYOUT } from "./tokens.js";
import { setWindowTitle } from "./window-title.js";
import { Rule } from "./Rule.js";

export interface HeaderProps {
    /** "dot init", "dot deploy", etc. Lowercase. First token rendered bold. */
    cmd: string;
    /** Second bread-crumb piece: "polkadot playground" or the domain being deployed. */
    subtitle?: string;
    /** Short network label — "paseo" on testnet. */
    network?: string;
    /** Right-aligned metadata; most commonly the CLI version. */
    right?: string;
    /**
     * Override for the terminal tab/window title. When omitted, we set
     * "{cmd} · {subtitle}" automatically. When a screen wants finer-grained
     * control (phase transitions, completion status), it can call
     * `setWindowTitle` directly from window-title.ts.
     */
    tabTitle?: string;
}

/**
 * Top-of-screen anchor.
 *
 * Renders a single-line breadcrumb `{cmd · subtitle · network}` followed by
 * a hairline rule, and — as a side effect — sets the user's terminal tab
 * title so they can see progress without refocusing the terminal.
 */
export function Header({ cmd, subtitle, network, right, tabTitle }: HeaderProps) {
    const { stdout } = useStdout();

    useEffect(() => {
        const title = tabTitle ?? defaultTabTitle(cmd, subtitle);
        setWindowTitle(title);
    }, [cmd, subtitle, tabTitle]);

    const pieces = [cmd, subtitle, network].filter((p): p is string => Boolean(p));
    const cols = stdout?.columns ?? 80;
    const width = Math.max(10, Math.min(cols - LAYOUT.leftMargin * 2, LAYOUT.ruleWidthMax));

    return (
        // marginTop guarantees a blank line above the banner even when a
        // third-party library (e.g. chain-client during domain validation)
        // writes console.log output above Ink's render tree — otherwise
        // those bled lines crowd the banner with no visual separator.
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
            <Box paddingLeft={LAYOUT.leftMargin} flexDirection="row" width={width}>
                <Box flexGrow={1} flexDirection="row">
                    {pieces.map((piece, i) => (
                        <React.Fragment key={i}>
                            {i > 0 && <Text dimColor>{"  ·  "}</Text>}
                            <Text bold={i === 0} dimColor={i > 0}>
                                {piece}
                            </Text>
                        </React.Fragment>
                    ))}
                </Box>
                {right && <Text dimColor>{right}</Text>}
            </Box>
            <Rule />
        </Box>
    );
}

function defaultTabTitle(cmd: string, subtitle: string | undefined): string {
    return subtitle ? `${cmd} · ${subtitle}` : cmd;
}
