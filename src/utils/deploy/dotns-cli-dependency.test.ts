import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pkg from "../../../package.json" with { type: "json" };

describe("DotNS CLI runtime dependency", () => {
    it("is declared directly so pnpm links it at the application root", () => {
        expect(pkg.dependencies).toHaveProperty("@parity/dotns-cli");
    });

    it("is resolvable from the package root for bulletin-deploy subprocess calls", () => {
        const requireFromRoot = createRequire(`${process.cwd()}/package.json`);
        expect(() => requireFromRoot.resolve("@parity/dotns-cli")).not.toThrow();
    });

    it("has a compiled-binary dispatcher for bulletin-deploy's PATH fallback", () => {
        const indexSource = readFileSync("src/index.ts", "utf8");
        const dispatcherSource = readFileSync("src/dotns-cli-dispatch.ts", "utf8");
        expect(indexSource).toContain('process.argv[2] !== "dotns"');
        expect(indexSource).toContain('import("./dotns-cli-dispatch.js")');
        expect(indexSource).toContain("withoutBundledDotnsCliWarning");
        expect(dispatcherSource).toContain(
            'from "../node_modules/@parity/dotns-cli/dist/cli.js" with { type: "file" }',
        );
        expect(dispatcherSource).toContain("pathToFileURL(dotnsCliPath)");
    });
});
