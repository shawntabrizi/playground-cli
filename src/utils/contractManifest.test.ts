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

import { afterEach, describe, expect, it, vi } from "vitest";
import {
    PLAYGROUND_REGISTRY_CONTRACT,
    suppressReviveTraceNoise,
    withoutReviveTraceNoise,
} from "./contractManifest.js";

const TRACE_NOISE = "Incompatible runtime entry RuntimeCall(ReviveApi_trace_call)";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("PLAYGROUND_REGISTRY_CONTRACT", () => {
    it("is the playground registry library name", () => {
        expect(PLAYGROUND_REGISTRY_CONTRACT).toBe("@w3s/playground-registry");
    });
});

describe("withoutReviveTraceNoise", () => {
    it("suppresses the known trace-call compat error while running fn", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await withoutReviveTraceNoise(async () => {
            console.error(`stack including ${TRACE_NOISE} here`);
            return 42;
        });

        expect(result).toBe(42);
        expect(spy).not.toHaveBeenCalled();
    });

    it("lets unrelated console.error through", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});

        await withoutReviveTraceNoise(async () => {
            console.error("a genuine error");
        });

        expect(spy).toHaveBeenCalledWith("a genuine error");
    });

    it("restores the original console.error after fn throws", async () => {
        const original = console.error;
        await expect(
            withoutReviveTraceNoise(async () => {
                throw new Error("boom");
            }),
        ).rejects.toThrow("boom");
        expect(console.error).toBe(original);
    });
});

describe("suppressReviveTraceNoise", () => {
    it("wraps query/tx/prepare so they swallow the trace noise", async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});

        const contract = {
            getAddress: {
                query: async () => {
                    console.error(`leak ${TRACE_NOISE}`);
                    return "ok";
                },
            },
        };

        const wrapped = suppressReviveTraceNoise(contract);
        await expect(wrapped.getAddress.query()).resolves.toBe("ok");
        expect(spy).not.toHaveBeenCalled();
    });

    it("leaves non-method properties untouched", () => {
        const contract = { address: "0xabc", getAddress: {} };
        const wrapped = suppressReviveTraceNoise(contract);
        expect(wrapped.address).toBe("0xabc");
    });
});
