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

/**
 * Current Bulletin authorization extents expose used counters plus granted
 * allowance totals. The CLI only needs remaining quota for preflight decisions
 * and `dot init` display.
 */

export interface AuthorizationExtent {
    transactions: bigint | number;
    transactions_allowance: bigint | number;
    bytes: bigint | number;
    bytes_allowance: bigint | number;
}

export interface RemainingAuthorizationExtent {
    transactions: number;
    bytes: bigint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function getNumericField(
    extent: Record<string, unknown>,
    field: keyof AuthorizationExtent,
): bigint {
    const value = extent[field];
    if (typeof value !== "bigint" && typeof value !== "number") {
        throw new Error(`Bulletin authorization extent is missing current field "${field}"`);
    }
    return BigInt(value);
}

function remaining(allowance: bigint, used: bigint): bigint {
    return allowance > used ? allowance - used : 0n;
}

export function remainingAuthorizationExtent(extent: unknown): RemainingAuthorizationExtent {
    if (!isRecord(extent)) {
        throw new Error("Bulletin authorization extent is malformed");
    }

    return {
        transactions: Number(
            remaining(
                getNumericField(extent, "transactions_allowance"),
                getNumericField(extent, "transactions"),
            ),
        ),
        bytes: remaining(
            getNumericField(extent, "bytes_allowance"),
            getNumericField(extent, "bytes"),
        ),
    };
}
