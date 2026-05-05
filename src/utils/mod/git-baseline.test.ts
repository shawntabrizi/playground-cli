import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOptionalGitBaseline } from "./git-baseline.js";

function tmpProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "dot-mod-git-baseline-"));
    writeFileSync(join(dir, "README.md"), "# modded app\n");
    return dir;
}

describe("createOptionalGitBaseline", () => {
    it("runs `git init` and creates no commit", async () => {
        const dir = tmpProject();
        const logs: string[] = [];
        try {
            await createOptionalGitBaseline(dir, (line) => logs.push(line));

            // .git directory is created by `git init`.
            expect(existsSync(join(dir, ".git"))).toBe(true);

            // No commits exist on HEAD — `git log` exits non-zero with the
            // "does not have any commits yet" wording on every supported git
            // version. We assert via execFileSync throwing.
            expect(() =>
                execFileSync("git", ["log"], { cwd: dir, stdio: "pipe" }),
            ).toThrow();

            expect(logs.join("\n")).toContain("initializing fresh git history");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("logs and continues when the optional git baseline cannot be created", async () => {
        const logs: string[] = [];
        await expect(
            createOptionalGitBaseline("/path/that/does/not/exist", (line) => logs.push(line)),
        ).resolves.toBeUndefined();
        expect(logs.join("\n")).toContain("git baseline skipped");
    });
});
