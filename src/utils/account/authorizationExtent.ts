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
