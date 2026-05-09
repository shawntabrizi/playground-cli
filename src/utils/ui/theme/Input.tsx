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

import { useState } from "react";
import { Box, Text, useInput } from "ink";
import { COLOR, GLYPH, LAYOUT } from "./tokens.js";

export interface InputProps {
    label: string;
    /** Value returned when the field is empty on submit. Also shown as "[default]". */
    initial?: string;
    /** Pre-populated editable value — unlike `initial`, the user sees/edits this. */
    prefill?: string;
    placeholder?: string;
    validate?: (value: string) => string | null;
    externalError?: string | null;
    onSubmit: (value: string) => void;
}

/** Single-line text input with cursor block + inline validation. */
export function Input({
    label,
    initial = "",
    prefill,
    placeholder,
    validate,
    externalError,
    onSubmit,
}: InputProps) {
    const [value, setValue] = useState(prefill ?? "");
    const [error, setError] = useState<string | null>(null);

    useInput((input, key) => {
        if (key.return) {
            const final = value.trim() || initial;
            if (validate) {
                const msg = validate(final);
                if (msg) {
                    setError(msg);
                    return;
                }
            }
            onSubmit(final);
            return;
        }
        if (key.backspace || key.delete) {
            setValue((v) => v.slice(0, -1));
            setError(null);
            return;
        }
        if (key.ctrl || key.meta) return;
        // Accept printable characters.
        if (input && input.length > 0 && input >= " " && input !== "\t") {
            setValue((v) => v + input);
            setError(null);
        }
    });

    const shownError = error ?? externalError ?? null;
    const showPlaceholder = value.length === 0 && placeholder;

    return (
        <Box flexDirection="column" paddingLeft={LAYOUT.leftMargin}>
            <Box>
                <Text bold>{label}</Text>
                {initial ? <Text dimColor>{`  default: ${initial}`}</Text> : null}
            </Box>
            <Box flexDirection="row">
                <Text color={COLOR.accent}>{`${GLYPH.cursor} `}</Text>
                <Text>{value}</Text>
                {showPlaceholder ? <Text dimColor>{placeholder}</Text> : null}
                <Text color={COLOR.accent}>{GLYPH.cursorBlock}</Text>
            </Box>
            {shownError && <Text color={COLOR.danger}>{shownError}</Text>}
        </Box>
    );
}
