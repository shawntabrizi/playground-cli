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
        expect(dispatcherSource).toContain('[process.argv[0] ?? "dot", scriptPath, ...argv]');
        expect(dispatcherSource).toContain("process.exit =");
        expect(dispatcherSource).not.toContain('"dotns", ...argv');
        expect(dispatcherSource).not.toContain(".main(");
    });
});
