/**
 * Resolves the path to the `dot` binary for E2E tests against a published
 * artefact. When `DOT_E2E_BINARY` is set, return that path (tests run against
 * the SEA binary). Otherwise return null and the caller should use the
 * source-build path via dot.ts.
 */
export function getPublishedBinaryPath(): string | null {
	return process.env.DOT_E2E_BINARY ?? null;
}
