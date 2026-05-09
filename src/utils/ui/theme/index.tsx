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
 * Theme plug — the complete public surface for the CLI's visual identity.
 *
 * Rules:
 *   1. Everything styled in the TUI imports from this file.
 *   2. No color literals, glyph literals, or spacing constants outside
 *      `src/utils/ui/theme/`.
 *   3. To re-skin: edit components in this directory and/or `tokens.ts`.
 *   4. To strip: replace these exports with passthrough components that
 *      render plain `<Text>`; the rest of the CLI keeps working.
 *
 * There is exactly one public surface (this file). If you find yourself
 * reaching into `./Row.js` from a screen, stop — add what you need to
 * this re-export list first.
 */

export { Header, type HeaderProps } from "./Header.js";
export { Row, type RowProps } from "./Row.js";
export { Mark, type MarkKind } from "./Mark.js";
export { Rule } from "./Rule.js";
export { Hint } from "./Hint.js";
export { Section } from "./Section.js";
export { Sparkline, type SparklineProps } from "./Sparkline.js";
export { Select, type SelectOption, type SelectProps } from "./Select.js";
export { Input, type InputProps } from "./Input.js";
export { LogTail, type LogTailProps } from "./LogTail.js";
export { Callout } from "./Callout.js";
export { setWindowTitle, clearWindowTitle } from "./window-title.js";
export { COLOR, GLYPH, LAYOUT, TIMING } from "./tokens.js";
