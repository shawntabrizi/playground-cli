/**
 * "Update available" banner shown at the bottom of every `dot` invocation.
 *
 * Resolves the latest CLI release through jsDelivr's free public CDN
 * (`data.jsdelivr.com/v1/packages/gh/<owner>/<repo>/resolved`) instead of the
 * GitHub releases API — jsDelivr is rate-limit-effectively-unlimited for our
 * scale and isn't shared with the GitHub anonymous-IP quota that `dot mod`
 * and `dot deploy --modable` already chip away at on hackathon WiFi.
 *
 * No on-disk cache: the call is fire-and-forget on command start with a 1 s
 * `AbortSignal.timeout`, so an unreachable jsDelivr cannot delay exit.
 *
 * The banner is suppressed when:
 *   - stdout is not a TTY (CI, piped output, e2e JUnit reports),
 *   - the user opted out via `DOT_NO_UPDATE_CHECK=1`,
 *   - the user is running `dot update` itself (it does its own fresh check),
 *   - the user is asking for `--version` / `-V` / `--help` / `-h` (banner
 *     would clutter machine-parseable output).
 */

import { GLYPH } from "./ui/theme/tokens.js";

const JSDELIVR_URL = "https://data.jsdelivr.com/v1/packages/gh/paritytech/playground-cli/resolved";
const FETCH_TIMEOUT_MS = 1000;

const ANSI_YELLOW = "\x1b[33m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_RESET = "\x1b[0m";

export interface VersionCheckHandle {
    /** Returns banner text (with trailing newlines) to print, or null. */
    render: () => Promise<string | null>;
}

export interface StartVersionCheckOptions {
    /** Override fetch (tests). */
    fetch?: typeof fetch;
    /** Override argv (tests). Defaults to `process.argv.slice(2)`. */
    argv?: readonly string[];
    /** Override env (tests). Defaults to `process.env`. */
    env?: NodeJS.ProcessEnv;
    /** Override TTY check (tests). Defaults to `process.stdout.isTTY`. */
    isTTY?: boolean;
}

/** "v0.16.14" → "0.16.14"; bare "0.16.14" stays "0.16.14". */
export function normalizeVersion(v: string): string {
    return v.replace(/^v/, "");
}

/**
 * True when `current` is a strictly older semver than `latest`. Falls back to
 * "not outdated" on parse failures so we never bother the user about a
 * comparison we couldn't actually make.
 */
export function isOutdated(current: string, latest: string): boolean {
    const c = normalizeVersion(current);
    const l = normalizeVersion(latest);
    if (c === l) return false;

    const cp = c.split(".").map((n) => Number.parseInt(n, 10));
    const lp = l.split(".").map((n) => Number.parseInt(n, 10));
    if (cp.some(Number.isNaN) || lp.some(Number.isNaN)) return false;

    const len = Math.max(cp.length, lp.length);
    for (let i = 0; i < len; i++) {
        const cv = cp[i] ?? 0;
        const lv = lp[i] ?? 0;
        if (cv < lv) return true;
        if (cv > lv) return false;
    }
    return false;
}

export function shouldSkip(
    argv: readonly string[],
    env: NodeJS.ProcessEnv,
    isTTY: boolean,
): boolean {
    if (!isTTY) return true;
    // Honour the docstring's stated CI-skip intent even when a CI runner
    // happens to present a TTY (some self-hosted runners, `act`, scripts
    // wrapped in `script -q -c …`).
    if (env.CI === "true" || env.CI === "1") return true;
    if (env.DOT_NO_UPDATE_CHECK === "1") return true;
    const first = argv[0];
    // Bare `dot` and `dot help <cmd>` both produce help output; suppress the
    // banner so we don't tail it onto a usage screen.
    if (argv.length === 0) return true;
    if (first === "update" || first === "help") return true;
    if (argv.includes("--version") || argv.includes("-V")) return true;
    if (argv.includes("--help") || argv.includes("-h")) return true;
    return false;
}

export function formatBanner(currentVersion: string, latestVersion: string): string {
    const current = `v${normalizeVersion(currentVersion)}`;
    const latest = `v${normalizeVersion(latestVersion)}`;
    // Intentionally a single-line `⚠` glyph rather than a rounded-box
    // Callout — this banner fires on EVERY `dot` invocation, so a heavier
    // visual treatment would quickly become noise.
    return (
        `\n  ${ANSI_YELLOW}${GLYPH.warn}${ANSI_RESET}  Update available: ${current} → ${latest}\n` +
        `     Run ${ANSI_BOLD}dot update${ANSI_RESET} to upgrade.\n`
    );
}

async function fetchLatestFromJsDelivr(fetchImpl: typeof fetch): Promise<string | null> {
    try {
        const res = await fetchImpl(JSDELIVR_URL, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: { Accept: "application/json" },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { version?: unknown };
        return typeof body.version === "string" && body.version ? body.version : null;
    } catch {
        return null;
    }
}

/**
 * Fires the latest-version fetch immediately and returns a handle whose
 * `render()` resolves the banner text (or null) for the caller to print at
 * the end of the command. Never throws.
 */
export function startVersionCheck(
    currentVersion: string,
    opts: StartVersionCheckOptions = {},
): VersionCheckHandle {
    const fetchImpl = opts.fetch ?? fetch;
    const argv = opts.argv ?? process.argv.slice(2);
    const env = opts.env ?? process.env;
    const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);

    if (shouldSkip(argv, env, isTTY)) {
        return { render: async () => null };
    }

    const inFlight = fetchLatestFromJsDelivr(fetchImpl);

    return {
        render: async () => {
            const latest = await inFlight;
            if (!latest) return null;
            if (!isOutdated(currentVersion, latest)) return null;
            return formatBanner(currentVersion, latest);
        },
    };
}
