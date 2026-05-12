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

import {
    createClient,
    type ChainDefinition,
    type PolkadotClient,
    type TypedApi,
} from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws";
import { getChainConfig } from "../config.js";
import { TESTNET_CHAIN_DESCRIPTORS, type TestnetChainDescriptors } from "./chainDescriptors.js";

export type ChainClient = {
    [K in keyof TestnetChainDescriptors]: TypedApi<TestnetChainDescriptors[K]>;
} & {
    raw: { [K in keyof TestnetChainDescriptors]: PolkadotClient };
    destroy(): void;
};

/** If the direct PAPI clients don't resolve in this window we treat the attempt as dead. */
const CONNECT_TIMEOUT_MS = 30_000;

let connectionPromise: Promise<ChainClient> | null = null;
let client: ChainClient | null = null;

function createRawClient(endpoints: readonly string[]): PolkadotClient {
    return createClient(getWsProvider([...endpoints]));
}

function typedApi<T extends ChainDefinition>(raw: PolkadotClient, descriptor: T): TypedApi<T> {
    return raw.getTypedApi(descriptor);
}

async function connectTestnet(): Promise<ChainClient> {
    const cfg = getChainConfig();
    const raw = {
        assetHub: createRawClient([cfg.assetHubRpc]),
        bulletin: createRawClient([cfg.bulletinRpc, ...cfg.bulletinRpcFallbacks]),
        individuality: createRawClient(cfg.peopleEndpoints),
    };

    let destroyed = false;
    return {
        assetHub: typedApi(raw.assetHub, TESTNET_CHAIN_DESCRIPTORS.assetHub),
        bulletin: typedApi(raw.bulletin, TESTNET_CHAIN_DESCRIPTORS.bulletin),
        individuality: typedApi(raw.individuality, TESTNET_CHAIN_DESCRIPTORS.individuality),
        raw,
        destroy() {
            if (destroyed) return;
            destroyed = true;
            raw.assetHub.destroy();
            raw.bulletin.destroy();
            raw.individuality.destroy();
        },
    };
}

function timeoutAfter(ms: number): Promise<never> {
    return new Promise((_, reject) =>
        setTimeout(
            () =>
                reject(
                    new Error(
                        `Timed out connecting to configured testnet chains after ${Math.round(
                            ms / 1000,
                        )}s`,
                    ),
                ),
            ms,
        ),
    );
}

export function getConnection(): Promise<ChainClient> {
    if (!connectionPromise) {
        connectionPromise = Promise.race([
            connectTestnet().then((c) => {
                client = c;
                return c;
            }),
            timeoutAfter(CONNECT_TIMEOUT_MS),
        ]).catch((err: unknown) => {
            // Reset so the next call can retry instead of replaying the error.
            connectionPromise = null;
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(
                `Could not connect to configured testnet network — check your internet connection (${detail})`,
                { cause: err instanceof Error ? err : undefined },
            );
        });
    }
    return connectionPromise;
}

export function destroyConnection(): void {
    if (client) {
        client.destroy();
        client = null;
    }
    connectionPromise = null;
}
