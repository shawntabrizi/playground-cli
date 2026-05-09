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
import { isTerminal, statusToRow } from "./status.js";
import type { LogoutStatus } from "../../utils/auth.js";

describe("isTerminal", () => {
    const cases: Array<[LogoutStatus, boolean]> = [
        [{ step: "disconnecting", address: "5Gxyz" }, false],
        [{ step: "success", address: "5Gxyz" }, true],
        [{ step: "partial", address: "5Gxyz", reason: "ws halted" }, true],
        [{ step: "error", message: "boom" }, true],
    ];

    for (const [status, expected] of cases) {
        it(`${status.step} → ${expected}`, () => {
            expect(isTerminal(status)).toBe(expected);
        });
    }
});

describe("statusToRow", () => {
    it("disconnecting shows the address being signed out", () => {
        expect(statusToRow({ step: "disconnecting", address: "5Gxyz" })).toEqual({
            mark: "run",
            label: "sign out",
            value: "5Gxyz",
            tone: "muted",
        });
    });

    it("success renders an ok mark with the address", () => {
        expect(statusToRow({ step: "success", address: "5Gxyz" })).toEqual({
            mark: "ok",
            label: "signed out",
            value: "5Gxyz",
            tone: "muted",
        });
    });

    it("partial surfaces the reason in the hint and the address in the value", () => {
        const row = statusToRow({
            step: "partial",
            address: "5Gxyz",
            reason: "ws halted",
        });
        expect(row.mark).toBe("warn");
        expect(row.value).toBe("5Gxyz");
        expect(row.tone).toBe("warning");
        expect(row.hint).toContain("ws halted");
        expect(row.hint).toContain("mobile app");
    });

    it("error renders the fail mark with the message as value", () => {
        expect(statusToRow({ step: "error", message: "permission denied" })).toEqual({
            mark: "fail",
            label: "sign out failed",
            value: "permission denied",
            tone: "danger",
        });
    });
});
