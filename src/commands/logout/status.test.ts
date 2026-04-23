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
