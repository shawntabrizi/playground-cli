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

import { pathToFileURL } from "node:url";
// @ts-expect-error Bun's file import attribute embeds the bundled DotNS CLI file.
import dotnsCliPath from "../node_modules/@parity/dotns-cli/dist/cli.js" with { type: "file" };

export function buildDotnsCliArgv(argv: string[], scriptPath = dotnsCliPath): string[] {
    return [process.argv[0] ?? "dot", scriptPath, ...argv];
}

export async function runDotnsCliSubprocess(argv: string[]): Promise<number> {
    const originalExit = process.exit;
    let resolved = false;
    const exitCode = new Promise<number>((resolve) => {
        process.exit = ((code?: string | number | null | undefined) => {
            const numericCode = typeof code === "number" ? code : 0;
            if (!resolved) {
                resolved = true;
                resolve(numericCode);
            }
            return originalExit(numericCode);
        }) as typeof process.exit;
    });

    process.argv = buildDotnsCliArgv(argv);
    try {
        // The bundled DotNS CLI auto-runs on import under Bun's compiled binary.
        await import(pathToFileURL(dotnsCliPath).href);
        return await exitCode;
    } finally {
        process.exit = originalExit;
    }
}
