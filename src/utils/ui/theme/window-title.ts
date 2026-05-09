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
 * Terminal tab/window title integration via OSC 0.
 *
 * Writes a short title string to the user's terminal so `dot <cmd>` shows
 * its status in the tab strip — even when the user tabs away. Hackathon
 * flow: kick off a deploy, switch to the browser, tab back later to see
 * "dot · my-app.dot · ✓" without refocusing the terminal first.
 *
 * OSC 0 (ESC ]0; TITLE BEL) sets both icon name and window title with the
 * widest terminal support: xterm, iTerm2, Kitty, WezTerm, Warp, Alacritty,
 * GNOME Terminal, macOS Terminal.app, and tmux/screen (which pass it to
 * the outer terminal).
 *
 * Guard: no-op when stdout is not a TTY — avoids leaking control codes
 * into CI logs and pipelines.
 */

const ESC = "\x1b";
const BEL = "\x07";

let lastTitle: string | null = null;

export function setWindowTitle(title: string): void {
    if (!process.stdout.isTTY) return;
    if (title === lastTitle) return;
    lastTitle = title;
    process.stdout.write(`${ESC}]0;${title}${BEL}`);
}

export function clearWindowTitle(): void {
    if (!process.stdout.isTTY) return;
    lastTitle = null;
    // Writing an empty title hands the tab back to the shell, which most
    // terminals interpret as "reset to default" (e.g. re-render the CWD).
    process.stdout.write(`${ESC}]0;${BEL}`);
}
