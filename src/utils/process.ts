/**
 * Streamed child-process helper. Consolidates the copies that used to live
 * in `build/runner.ts`, `deploy/contracts.ts`, and `toolchain.ts`.
 */

import { spawn } from "node:child_process";

export interface RunStreamedOptions {
    cmd: string;
    args: string[];
    cwd?: string;
    /** Human label for the spawn + failure error messages. */
    description?: string;
    /** Prefix prepended to the error message on non-zero exit. Defaults to "Command failed". */
    failurePrefix?: string;
    /** Called for every non-empty stdout/stderr line. */
    onData?: (line: string) => void;
}

/**
 * Spawn a child process, stream every non-empty stdout/stderr line through
 * `onData`, and resolve/reject based on exit code. Includes the last ~10
 * lines of output in the rejection message so failures are diagnosable.
 */
export async function runStreamed(opts: RunStreamedOptions): Promise<void> {
    const description = opts.description ?? `${opts.cmd} ${opts.args.join(" ")}`;
    const failurePrefix = opts.failurePrefix ?? "Command failed";

    await new Promise<void>((resolvePromise, rejectPromise) => {
        const child = spawn(opts.cmd, opts.args, {
            cwd: opts.cwd,
            stdio: ["ignore", "pipe", "pipe"],
            env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
        });

        const tail: string[] = [];
        const MAX_TAIL = 50;

        const forward = (chunk: Buffer) => {
            for (const line of chunk.toString().split("\n")) {
                if (line.length === 0) continue;
                tail.push(line);
                if (tail.length > MAX_TAIL) tail.shift();
                opts.onData?.(line);
            }
        };

        child.stdout.on("data", forward);
        child.stderr.on("data", forward);
        child.on("error", (err) =>
            rejectPromise(
                new Error(`Failed to spawn "${description}": ${err.message}`, { cause: err }),
            ),
        );
        child.on("close", (code) => {
            if (code === 0) {
                resolvePromise();
            } else {
                const snippet = tail.slice(-10).join("\n") || "(no output)";
                rejectPromise(
                    new Error(
                        `${failurePrefix} (${description}) with exit code ${code}.\n${snippet}`,
                    ),
                );
            }
        });
    });
}

/**
 * Convenience wrapper around {@link runStreamed} that takes a shell command
 * string rather than a program + args array. Intended for pasting a shell
 * one-liner verbatim (curl | bash installers, chained commands); anything
 * structured should use the arg-array form for safety.
 */
export async function runShell(cmd: string, onData?: (line: string) => void): Promise<void> {
    await runStreamed({
        cmd: "bash",
        args: ["-c", cmd],
        description: cmd,
        onData,
    });
}
