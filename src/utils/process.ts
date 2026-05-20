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
 * Streamed child-process helper. Consolidates the copies that used to live
 * in `build/runner.ts`, `deploy/contracts.ts`, and `toolchain.ts`.
 */

import { spawn } from "node:child_process";

export interface RunStreamedOptions {
    cmd: string;
    args: string[];
    cwd?: string;
    /** Human label for the spawn + failure error messages. */
    description?: string;
    /** Prefix prepended to the error message on non-zero exit. Defaults to "Command failed". */
    failurePrefix?: string;
    /** Called for every non-empty stdout/stderr line. */
    onData?: (line: string) => void;
}

/**
 * Spawn a child process, stream every non-empty stdout/stderr line through
 * `onData`, and resolve/reject based on exit code. Includes the last ~40
 * lines of output in the rejection message so failures are diagnosable.
 *
 * The window is 40 (not 10) because Vite/Rollup and many bundlers print the
 * meaningful error first and then a 10–20 line stack trace; a smaller window
 * keeps the trace and drops the message that explains what actually broke.
 */
export async function runStreamed(opts: RunStreamedOptions): Promise<void> {
    const description = opts.description ?? `${opts.cmd} ${opts.args.join(" ")}`;
    const failurePrefix = opts.failurePrefix ?? "Command failed";

    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(opts.cmd, opts.args, {
            cwd: opts.cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
        });

        const tail: string[] = [];
        const MAX_TAIL = 40;

        const forward = (chunk: Buffer) => {
            for (const line of chunk.toString().split("\n")) {
                if (line.length === 0) continue;
                tail.push(line);
                if (tail.length > MAX_TAIL) tail.shift();
                opts.onData?.(line);
            }
        };

        child.stdout.on("data", forward);
        child.stderr.on("data", forward);
        child.on("error", (err) =>
            rejectPromise(
                new Error(`Failed to spawn "${description}": ${err.message}`, { cause: err }),
            ),
        );
        child.on("close", (code) => {
            if (code === 0) {
                resolvePromise();
            } else {
                const snippet = tail.join("\n") || "(no output)";
                rejectPromise(
                    new Error(
                        `${failurePrefix} (${description}) with exit code ${code}.\n${snippet}`,
                    ),
                );
            }
        });
    });
}

/**
 * Convenience wrapper around {@link runStreamed} that takes a shell command
 * string rather than a program + args array. Intended for pasting a shell
 * one-liner verbatim (curl | bash installers, chained commands); anything
 * structured should use the arg-array form for safety.
 */
export async function runShell(cmd: string, onData?: (line: string) => void): Promise<void> {
    await runStreamed({
        cmd: "bash",
        args: ["-c", cmd],
        description: cmd,
        onData,
    });
}
