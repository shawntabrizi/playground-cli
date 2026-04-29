import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOptionalGitBaseline } from "./git-baseline.js";

function tmpProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "dot-mod-git-baseline-"));
    writeFileSync(join(dir, "README.md"), "# modded app\n");
    return dir;
}

function git(dir: string, args: string[]): string {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

describe("createOptionalGitBaseline", () => {
    it("creates an unsigned baseline commit even when signing is globally required", async () => {
        const dir = tmpProject();
        const logs: string[] = [];
        try {
            git(dir, ["init"]);
            git(dir, ["config", "user.name", "dot mod"]);
            git(dir, ["config", "user.email", "dot-mod@example.invalid"]);
            git(dir, ["config", "commit.gpgsign", "true"]);

            await createOptionalGitBaseline(dir, "rock-paper-scissors.dot", (line) =>
                logs.push(line),
            );

            expect(git(dir, ["log", "-1", "--pretty=%s"])).toBe(
                "Initial commit from rock-paper-scissors.dot",
            );
            expect(logs.join("\n")).toContain("creating unsigned baseline commit");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("logs and continues when the optional git baseline cannot be created", async () => {
        const logs: string[] = [];
        await expect(
            createOptionalGitBaseline("/path/that/does/not/exist", "broken.dot", (line) =>
                logs.push(line),
            ),
        ).resolves.toBeUndefined();
        expect(logs.join("\n")).toContain("git baseline skipped");
    });
});
