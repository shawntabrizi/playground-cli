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

import { describe, it, expect, vi, beforeEach } from "vitest";

const { stopWatchdog, startMemoryWatchdog, scheduleHardExit, onProcessShutdown } = vi.hoisted(
    () => {
        const stopWatchdog = vi.fn();
        return {
            stopWatchdog,
            startMemoryWatchdog: vi.fn(() => stopWatchdog),
            scheduleHardExit: vi.fn(),
            onProcessShutdown: vi.fn(),
        };
    },
);

vi.mock("./utils/process-guard.js", () => ({
    startMemoryWatchdog,
    scheduleHardExit,
    onProcessShutdown,
}));

vi.mock("./telemetry.js", () => ({
    withCommandTelemetry: vi.fn(async (_name: string, fn: any) => fn()),
}));

import { runCliCommand } from "./cli-runtime.js";

describe("runCliCommand", () => {
    beforeEach(() => {
        stopWatchdog.mockClear();
        startMemoryWatchdog.mockClear();
        scheduleHardExit.mockClear();
        onProcessShutdown.mockClear();
        process.exitCode = 0;
    });

    it("runs the action wrapped in command telemetry and schedules hard exit", async () => {
        const action = vi.fn(async () => "ok");
        await runCliCommand("build", { watchdog: false, hardExit: true }, action);
        expect(action).toHaveBeenCalledTimes(1);
        expect(scheduleHardExit).toHaveBeenCalledWith(0);
    });

    it("starts and stops the memory watchdog when watchdog:true", async () => {
        await runCliCommand("deploy", { watchdog: true, hardExit: false }, async () => {});
        expect(startMemoryWatchdog).toHaveBeenCalledTimes(1);
        expect(stopWatchdog).toHaveBeenCalledTimes(1);
    });

    it("starts the memory watchdog BY DEFAULT when the option is omitted", async () => {
        // Regression guard for the June 2026 zombie incident: `playground
        // init` ran without the watchdog, a leaked subscription starved the
        // event loop (so signal handlers, hardExit timers, and index.ts's
        // final process.exit all stopped firing), and three invisible
        // processes grew past 40 GB each. The worker-thread watchdog is the
        // only guard that survives that state, so every command gets it
        // unless it explicitly opts out.
        await runCliCommand("init", { hardExit: false }, async () => {});
        expect(startMemoryWatchdog).toHaveBeenCalledTimes(1);
        expect(stopWatchdog).toHaveBeenCalledTimes(1);
    });

    it("does not start the watchdog when explicitly opted out", async () => {
        await runCliCommand("build", { watchdog: false, hardExit: false }, async () => {});
        expect(startMemoryWatchdog).not.toHaveBeenCalled();
    });

    it("propagates errors but still schedules hard exit with non-zero code", async () => {
        process.exitCode = 1;
        await expect(
            runCliCommand("deploy", { watchdog: false, hardExit: true }, async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        expect(scheduleHardExit).toHaveBeenCalledWith(1);
    });

    it("stops watchdog even when the action throws", async () => {
        await expect(
            runCliCommand("deploy", { watchdog: true, hardExit: false }, async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        expect(stopWatchdog).toHaveBeenCalledTimes(1);
    });

    it("does NOT schedule hard exit when the action throws without setting process.exitCode", async () => {
        // process.exitCode is reset to 0 in beforeEach. The throw without explicit
        // exit code means runCliCommand should let the error propagate naturally to
        // src/index.ts's outer catch (which prints + sets exitCode + exits). If
        // runCliCommand pre-set exitCode here, index.ts's gated printer would skip
        // the user-visible message and the process would exit silently.
        await expect(
            runCliCommand("deploy", { watchdog: false, hardExit: true }, async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        expect(scheduleHardExit).not.toHaveBeenCalled();
    });

    it("preserves an explicit non-zero exit code set before throw", async () => {
        process.exitCode = 5;
        await expect(
            runCliCommand("deploy", { watchdog: false, hardExit: true }, async () => {
                throw new Error("non-default code");
            }),
        ).rejects.toThrow("non-default code");
        expect(scheduleHardExit).toHaveBeenCalledWith(5);
    });
});
