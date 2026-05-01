import { describe, it, expect, vi } from "vitest";

vi.mock("../../telemetry.js", () => ({
    withSpan: vi.fn(async (_op: string, _name: string, _attrs: any, fn: any) => fn()),
    sanitizedErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { withDeployPhase } from "./phase.js";
import type { DeployEvent } from "./run.js";

describe("withDeployPhase", () => {
    it("emits phase-start, runs fn, emits phase-complete on success", async () => {
        const events: DeployEvent[] = [];
        const result = await withDeployPhase(
            "build",
            "cli.deploy.build",
            { "cli.deploy.x": "y" },
            (e) => events.push(e),
            async () => 7,
        );
        expect(result).toBe(7);
        expect(events.map((e) => e.kind)).toEqual(["phase-start", "phase-complete"]);
    });

    it("emits error and rethrows on failure", async () => {
        const events: DeployEvent[] = [];
        await expect(
            withDeployPhase("build", "cli.deploy.build", {}, (e) => events.push(e), async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        expect(events.map((e) => e.kind)).toEqual(["phase-start", "error"]);
        const err = events[1];
        if (err.kind !== "error") throw new Error("type guard");
        expect(err.phase).toBe("build");
        expect(err.message).toBe("boom");
    });
});
