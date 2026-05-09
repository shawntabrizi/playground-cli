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

import { describe, it, expect } from "vitest";
import { runStreamed, runShell } from "./process.js";

describe("runStreamed", () => {
    it("resolves on exit 0 and forwards every non-empty stdout line to onData in order", async () => {
        const lines: string[] = [];
        await runStreamed({
            cmd: "/bin/sh",
            args: ["-c", 'printf "a\\nb\\nc\\n"'],
            onData: (line) => lines.push(line),
        });
        expect(lines).toEqual(["a", "b", "c"]);
    });

    it("rejects on non-zero exit with failurePrefix, description, code, and output tail in the message", async () => {
        await expect(
            runStreamed({
                cmd: "/bin/sh",
                args: ["-c", "echo oops >&2; exit 7"],
                description: "run-test-cmd",
                failurePrefix: "TestPrefix",
            }),
        ).rejects.toThrow(/TestPrefix.*run-test-cmd.*exit code 7[\s\S]*oops/);
    });

    it("routes stderr lines to the same onData sink as stdout (not dropped)", async () => {
        const lines: string[] = [];
        await expect(
            runStreamed({
                cmd: "/bin/sh",
                args: ["-c", "echo from-stdout; echo from-stderr >&2; exit 1"],
                onData: (line) => lines.push(line),
            }),
        ).rejects.toThrow();
        expect(lines).toContain("from-stdout");
        expect(lines).toContain("from-stderr");
    });

    it("rejects with 'Failed to spawn' and the description when the binary does not exist", async () => {
        await expect(
            runStreamed({
                cmd: "/this/definitely/does/not/exist-xyz",
                args: [],
                description: "missing-bin",
            }),
        ).rejects.toThrow(/Failed to spawn.*missing-bin/);
    });

    it("defaults failurePrefix to 'Command failed' and description to cmd + args when not provided", async () => {
        try {
            await runStreamed({
                cmd: "/bin/sh",
                args: ["-c", "exit 2"],
            });
            expect.fail("expected rejection");
        } catch (err) {
            const msg = (err as Error).message;
            expect(msg).toContain("Command failed");
            expect(msg).toContain("/bin/sh");
            expect(msg).toContain("-c");
            expect(msg).toContain("exit 2");
        }
    });

    it("falls back to '(no output)' in the error message when the process produced nothing", async () => {
        await expect(
            runStreamed({
                cmd: "/bin/sh",
                args: ["-c", "exit 4"],
                description: "silent-fail",
            }),
        ).rejects.toThrow(/\(no output\)/);
    });

    it("caps the captured tail and reports only the LAST 10 lines on failure (not the first)", async () => {
        // Generate 60 numbered lines, then exit 1. Tail buffer holds the last
        // 50; the error message shows the last 10 of those — so 51..60.
        try {
            await runStreamed({
                cmd: "/bin/sh",
                args: ["-c", "for i in $(seq 1 60); do echo line-$i; done; exit 1"],
                description: "tail-test",
            });
            expect.fail("expected rejection");
        } catch (err) {
            const msg = (err as Error).message;
            // Last 10 lines must appear.
            for (let i = 51; i <= 60; i++) {
                expect(msg).toContain(`line-${i}`);
            }
            // Anything earlier must NOT: confirms we're taking the tail, not
            // the head, and that the slice is capped at 10.
            expect(msg).not.toContain("line-1\n");
            expect(msg).not.toContain("line-50\n");
            expect(msg).not.toContain("line-10\n");
        }
    });
});

describe("runShell", () => {
    it("delegates to bash -c and surfaces the exit code in the rejection message", async () => {
        await expect(runShell("exit 3")).rejects.toThrow(/exit code 3/);
    });

    it("uses the shell command string as the description in failure messages", async () => {
        // The wrapper passes `description: cmd`, so the exact one-liner should
        // round-trip into the error for diagnosability.
        await expect(runShell("echo boom >&2; exit 1")).rejects.toThrow(/echo boom >&2; exit 1/);
    });

    it("resolves and forwards stdout lines through onData on success", async () => {
        const lines: string[] = [];
        await runShell('printf "x\\ny\\n"', (line) => lines.push(line));
        expect(lines).toEqual(["x", "y"]);
    });
});
