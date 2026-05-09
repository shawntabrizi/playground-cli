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

import { getChainConfig, type Env } from "../config.js";

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export interface BulletinFetchOptions {
    timeoutMs?: number;
}

export function getBulletinGateway(env?: Env): string {
    return getChainConfig(env).bulletinGateway;
}

export function bulletinGatewayUrl(cid: string, gateway: string): string {
    return `${gateway}${cid}`;
}

export async function fetchBulletinBytes(
    cid: string,
    gateway: string,
    options?: BulletinFetchOptions,
): Promise<Uint8Array> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(bulletinGatewayUrl(cid, gateway), {
            signal: controller.signal,
        });
        if (!response.ok) {
            throw new Error(`Gateway returned ${response.status}: ${response.statusText}`);
        }
        return new Uint8Array(await response.arrayBuffer());
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchBulletinJson<T>(
    cid: string,
    gateway: string,
    options?: BulletinFetchOptions,
): Promise<T> {
    const bytes = await fetchBulletinBytes(cid, gateway, options);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
