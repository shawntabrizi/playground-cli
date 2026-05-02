import { describe, expect, it } from "vitest";
import { pickNextStage } from "./DeployScreen.js";

describe("pickNextStage", () => {
    it("continues past modable preflight once a repository URL is resolved", () => {
        expect(
            pickNextStage(
                false,
                "phone",
                "dist",
                "tw33d3r.dot",
                true,
                false,
                true,
                "git@github.com:charlesHetterich/tw33d3r",
            ),
        ).toEqual({ kind: "confirm" });
    });

    it("enters modable preflight when modable is true and no repository URL is resolved yet", () => {
        expect(
            pickNextStage(false, "phone", "dist", "tw33d3r.dot", true, false, true, null),
        ).toEqual({ kind: "modable-preflight" });
    });
});
