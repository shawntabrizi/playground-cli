/**
 * Typed execa wrapper for spawning `dot` CLI commands in E2E tests.
 *
 * Runs the CLI via `bun run src/index.ts` so we don't need a compiled binary.
 * Captures stdout/stderr and exit code for test assertions.
 */

import { execa as execaFn } from "execa";
import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../../");
const CLI_ENTRY = resolve(REPO_ROOT, "src/index.ts");
const DEFAULT_TIMEOUT = 90_000;

export interface DotOptions {
	cwd?: string;
	env?: Record<string, string>;
	timeout?: number;
	/**
	 * Override HOME so the CLI reads/writes sessions from a temp dir
	 * instead of ~/.polkadot-apps/. Useful for session isolation in tests.
	 * See paritytech/polkadot-apps#109 for upstream test helper.
	 */
	home?: string;
}

export interface DotResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Run the `dot` CLI with the given args. Does NOT throw on non-zero exit —
 * let tests assert on exitCode directly.
 */
export async function dot(args: string[], options?: DotOptions): Promise<DotResult> {
	return run(args, options);
}

/**
 * Run the `dot` CLI and throw if exit code is non-zero.
 */
export async function dotOrThrow(args: string[], options?: DotOptions): Promise<DotResult> {
	const result = await run(args, options);
	if (result.exitCode !== 0) {
		throw new Error(
			`dot ${args.join(" ")} exited with code ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
		);
	}
	return result;
}

/**
 * Run the `dot` CLI with --suri injected for a dev account.
 */
export async function dotWithSuri(
	suri: string,
	args: string[],
	options?: DotOptions,
): Promise<DotResult> {
	return dot([...args, "--suri", suri], options);
}

// ── Internal ────────────────────────────────────────────────────────────────

async function run(args: string[], options?: DotOptions): Promise<DotResult> {
	const dotTag = process.env.DOT_TAG ?? "e2e-local";
	const env: Record<string, string> = {
		DOT_TAG: dotTag,
		// Forward a bulletin-deploy telemetry tag so deploy-pipeline spans are
		// tagged as playground-CLI E2E traffic (e2e-cli-*) rather than real-user
		// traffic. The e2e-cli- prefix distinguishes us from bulletin-deploy's own
		// E2E suite, which uses bare e2e-* tags. Respect any explicit DEPLOY_TAG
		// override (e.g. e2e-ci-post-release set by the post-release workflow).
		DEPLOY_TAG: process.env.DEPLOY_TAG ?? "e2e-cli-" + dotTag.replace(/^e2e-/, ""),
		DOT_TELEMETRY: process.env.DOT_TELEMETRY ?? "1",
		...options?.env,
	};
	if (options?.home) {
		env.HOME = options.home;
	}

	const startedAt = Date.now();
	try {
		const result = await execaFn("bun", ["run", CLI_ENTRY, ...args], {
			cwd: options?.cwd ?? REPO_ROOT,
			env,
			timeout: options?.timeout ?? DEFAULT_TIMEOUT,
			reject: false,
		});
		const dotResult: DotResult = {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode ?? 1,
		};
		appendForensicLog(args, dotResult, Date.now() - startedAt);
		return dotResult;
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		const dotResult: DotResult = { stdout: "", stderr: msg, exitCode: 1 };
		appendForensicLog(args, dotResult, Date.now() - startedAt);
		return dotResult;
	}
}

function appendForensicLog(args: string[], result: DotResult, durationMs: number): void {
	const reportsDir = resolve(REPO_ROOT, "e2e-reports");
	try {
		mkdirSync(reportsDir, { recursive: true });
		const entry = [
			`# ${new Date().toISOString()}  exit=${result.exitCode}  durationMs=${durationMs}`,
			`# args: ${args.map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(" ")}`,
			`--- stdout ---`,
			result.stdout,
			`--- stderr ---`,
			result.stderr,
			``,
		].join("\n");
		appendFileSync(resolve(reportsDir, "dot-runs.log"), entry);
	} catch {
		// Forensic logging must never fail a test. Swallow.
	}
}
