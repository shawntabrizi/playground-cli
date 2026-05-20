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

    it("caps the captured tail and reports only the LAST 40 lines on failure (not the first)", async () => {
        // Generate 60 numbered lines, then exit 1. Tail buffer holds the last
        // 40, which is what the error message reports — so 21..60.
        try {
            await runStreamed({
                cmd: "/bin/sh",
                args: ["-c", "for i in $(seq 1 60); do echo line-$i; done; exit 1"],
                description: "tail-test",
            });
            expect.fail("expected rejection");
        } catch (err) {
            const msg = (err as Error).message;
            // Last 40 lines must appear.
            for (let i = 21; i <= 60; i++) {
                expect(msg).toContain(`line-${i}`);
            }
            // Anything earlier must NOT: confirms we're taking the tail, not
            // the head, and that the buffer is capped at 40.
            expect(msg).not.toContain("line-1\n");
            expect(msg).not.toContain("line-20\n");
        }
    });

    it("preserves a Vite/Rollup-style error message that precedes a long stack trace", async () => {
        // Realistic shape: vite prints the build banner, a single descriptive
        // error line, a code snippet, and finally a ~12-frame stack trace.
        // With the older 10-line snippet the actual error was pushed off the
        // window by the trailing trace; the wider window keeps it visible.
        const script = [
            "echo 'vite v7.3.2 building client environment for production...'",
            "echo 'transforming...'",
            "echo '✓ 1544 modules transformed.'",
            "echo '✗ Build failed in 843ms'",
            "echo 'error during build:'",
            `echo '  src/utils/contracts.ts (40:9): \"createContractRuntimeFromClient\" is not exported by node_modules/@parity/product-sdk-contracts/dist/index.js'`,
            "echo 'file: /tmp/contracts.ts:40:9'",
            "echo '38: import type { PolkadotSigner } from \"polkadot-api\";'",
            "echo '39: import { keccak256 } from \"@parity/product-sdk-utils\";'",
            "echo '40: import { createContractRuntimeFromClient } from \"@parity/product-sdk-contracts\";'",
            "echo '             ^'",
            "echo '41: import { paseo_asset_hub } from \"@parity/product-sdk-descriptors\";'",
            "for i in $(seq 1 12); do echo '    at frame-'$i' (file:///.../rollup/dist/es/shared/node-entry.js:1234:5)'; done",
            "exit 1",
        ].join("; ");

        try {
            await runStreamed({
                cmd: "/bin/sh",
                args: ["-c", script],
                description: "vite-like-failure",
            });
            expect.fail("expected rejection");
        } catch (err) {
            const msg = (err as Error).message;
            expect(msg).toContain('"createContractRuntimeFromClient" is not exported');
            expect(msg).toContain("at frame-12");
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
