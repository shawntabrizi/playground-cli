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

/**
 * Design tokens — the entire identity of the CLI's TUI in one file.
 *
 * To restyle the CLI, edit this file.
 * To reskin it, swap every component in this directory.
 * To strip it, replace the `index.tsx` exports with passthrough components
 * that render plain `<Text>` — everything else keeps working.
 *
 * Hard rule: no color literals, no glyph literals, no spacing numbers
 * anywhere in `src/commands/*`. They all live here.
 *
 * Why named ANSI colors only: the 16 named colors are safe under every
 * popular terminal theme (light / dark / solarized / gruvbox / dracula).
 * Truecolor is intentionally avoided — we don't fight the user's palette.
 */

export const COLOR = {
    accent: "magenta",
    success: "green",
    danger: "red",
    warning: "yellow",
} as const;

export const GLYPH = {
    ok: "✓",
    fail: "✕",
    warn: "⚠",
    pending: "·",
    cursor: "›",
    separator: "·",
    rule: "─",
    cursorBlock: "█",
    spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const,
    bars: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const,
} as const;

export const LAYOUT = {
    leftMargin: 2,
    ruleWidthMax: 72,
    defaultLabelWidth: 14,
} as const;

export const TIMING = {
    spinnerMs: 80,
} as const;
