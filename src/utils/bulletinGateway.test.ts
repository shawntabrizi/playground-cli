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

import { describe, it, expect, vi, afterEach } from "vitest";
import {
    bulletinGatewayUrl,
    fetchBulletinBytes,
    fetchBulletinJson,
    getBulletinGateway,
} from "./bulletinGateway.js";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe("bulletinGatewayUrl", () => {
    it("concatenates gateway and CID without inserting separators", () => {
        // The gateway value already ends in `/ipfs/`; the helper just appends
        // the CID. Returning a real URL via `URL()` would be wrong because
        // the trailing-slash convention lives in the config string itself.
        expect(bulletinGatewayUrl("bafyabc", "https://example.test/ipfs/")).toBe(
            "https://example.test/ipfs/bafyabc",
        );
    });
});

describe("getBulletinGateway", () => {
    it("returns the testnet gateway by default", () => {
        // Defaults to DEFAULT_ENV (testnet); no env arg required.
        expect(getBulletinGateway()).toBe("https://paseo-ipfs.polkadot.io/ipfs/");
    });

    it("returns the same URL when explicitly asked for testnet", () => {
        expect(getBulletinGateway("testnet")).toBe("https://paseo-ipfs.polkadot.io/ipfs/");
    });
});

describe("fetchBulletinBytes", () => {
    it("returns the response bytes when the gateway returns 2xx", async () => {
        const payload = new Uint8Array([1, 2, 3, 4]);
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(payload, { status: 200 })),
        );

        const out = await fetchBulletinBytes("bafyabc", "https://example.test/ipfs/");
        expect(out).toEqual(payload);
    });

    it("throws an error containing the status when the gateway returns non-2xx", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(null, { status: 404, statusText: "Not Found" })),
        );

        await expect(
            fetchBulletinBytes("bafymissing", "https://example.test/ipfs/"),
        ).rejects.toThrow(/Gateway returned 404/);
    });

    it("aborts the request via AbortController when the timeout elapses", async () => {
        // Capture the AbortSignal so we can assert it actually got triggered.
        // The real fetch implementation rejects on abort; we mirror that.
        const fetchMock = vi.fn(
            (_url: string, init: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () => {
                        reject(new DOMException("aborted", "AbortError"));
                    });
                }),
        );
        vi.stubGlobal("fetch", fetchMock);
        vi.useFakeTimers();

        const promise = fetchBulletinBytes("bafytimeout", "https://example.test/ipfs/", {
            timeoutMs: 50,
        });
        vi.advanceTimersByTime(60);
        await expect(promise).rejects.toThrow(/aborted/);
    });
});

describe("fetchBulletinJson", () => {
    it("decodes the response bytes and parses them as JSON", async () => {
        const body = new TextEncoder().encode(JSON.stringify({ hello: "world", n: 42 }));
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(body, { status: 200 })),
        );

        const out = await fetchBulletinJson<{ hello: string; n: number }>(
            "bafyabc",
            "https://example.test/ipfs/",
        );
        expect(out).toEqual({ hello: "world", n: 42 });
    });

    it("propagates non-2xx errors from fetchBulletinBytes", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response(null, { status: 502, statusText: "Bad Gateway" })),
        );

        await expect(fetchBulletinJson("bafyfail", "https://example.test/ipfs/")).rejects.toThrow(
            /Gateway returned 502/,
        );
    });
});
