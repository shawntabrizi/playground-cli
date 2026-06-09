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
 * Parallel multi-app deploy orchestrator.
 *
 * Runs several single-app deploys (each one a `runDeploy` call) within ONE CLI
 * invocation, up to `concurrency` at a time. Builds and Bulletin uploads run in
 * parallel; the on-chain SIGNING phases are serialized per signer account via a
 * shared {@link SigningGateRegistry}, so concurrent deploys that share a signer
 * (the common case: all apps with `--signer dev`) never collide on a nonce.
 *
 * Why one process instead of N concurrent `playground deploy` processes: a
 * shared in-memory signing gate is the simplest correct nonce-safety mechanism.
 * Coordinating nonces across separate OS processes would need an on-disk lock
 * or a nonce-reservation file — strictly more moving parts for the same effect.
 * This module owns the gate; the per-app `runDeploy` honours it.
 *
 * The result is per-app and machine-readable: callers get an ordered list of
 * `{ app, status, outcome | error }` so an orchestrator (or a `--json` printer)
 * can report exactly which apps succeeded without scraping interleaved logs.
 */

import { runDeploy, type DeployEvent, type DeployOutcome, type RunDeployOptions } from "./run.js";
import { createSigningGateRegistry } from "./signingGate.js";

/**
 * One app to deploy. Mirrors the per-app subset of {@link RunDeployOptions};
 * the cross-cutting options (signer mode, env, publish flags) are supplied once
 * in {@link RunParallelDeploysOptions} and applied to every app.
 */
export interface ParallelDeployApp {
    /** Stable identifier used in events and results (e.g. the package name). */
    name: string;
    /** Project root — where this app's build runs. */
    projectDir: string;
    /** Absolute (or project-relative) directory holding the built artifacts. */
    buildDir: string;
    /** DotNS label (with or without `.dot`). */
    domain: string;
    /** Per-app override: skip this app's build. Defaults to the shared value. */
    skipBuild?: boolean;
    /** Per-app override: record this repo URL when `moddable`. */
    repositoryUrl?: string | null;
}

/**
 * The on-chain identity an app's extrinsics sign as. Apps that resolve to the
 * SAME key string share a signing gate; apps with different keys deploy fully in
 * parallel. The caller computes this from the resolved signer setup (e.g. the
 * dev publish address, or the session SS58) so the orchestrator stays agnostic
 * to signer-mode internals.
 */
export type SignerKeyResolver = (app: ParallelDeployApp) => string;

export interface RunParallelDeploysOptions {
    apps: ParallelDeployApp[];
    /** Max apps building/uploading at once. Clamped to `[1, apps.length]`. */
    concurrency: number;
    /**
     * Maps each app to its on-chain signer key so same-account deploys share a
     * gate. Returning a single constant string serializes ALL signing (the safe
     * default for one shared `--signer dev`); returning per-app keys parallelizes
     * signing across distinct accounts.
     */
    signerKey: SignerKeyResolver;
    /**
     * Builds the {@link RunDeployOptions} for one app, minus `signingGate` and
     * `onEvent` (the orchestrator injects those). Keeps signer resolution,
     * plan/availability, and publish flags in the caller's hands.
     */
    buildRunOptions: (
        app: ParallelDeployApp,
    ) => Promise<Omit<RunDeployOptions, "signingGate" | "onEvent">>;
    /** Per-app event sink, tagged with the app name for interleaved streams. */
    onEvent?: (app: string, event: DeployEvent) => void;
    /** Notified as each app settles, so callers can print incremental status. */
    onAppSettled?: (result: ParallelDeployResult) => void;
}

export type ParallelDeployResult =
    | { name: string; domain: string; status: "success"; outcome: DeployOutcome }
    | { name: string; domain: string; status: "failed"; error: string };

export interface ParallelDeploySummary {
    results: ParallelDeployResult[];
    succeeded: number;
    failed: number;
}

/** Clamp concurrency into `[1, n]` so a bad flag value can't stall or overrun. */
export function clampConcurrency(requested: number, appCount: number): number {
    if (appCount <= 0) return 1;
    if (!Number.isFinite(requested) || requested < 1) return 1;
    return Math.min(Math.floor(requested), appCount);
}

/**
 * Deploy every app, respecting `concurrency` and the per-account signing gate.
 *
 * Never rejects on a single app's failure: each app's error is captured into
 * its result so one bad deploy doesn't abort the others (the whole point of a
 * batch deploy). Results preserve the input order regardless of finish order.
 * The caller decides the process exit code from `summary.failed`.
 */
export async function runParallelDeploys(
    options: RunParallelDeploysOptions,
): Promise<ParallelDeploySummary> {
    const { apps } = options;
    const gates = createSigningGateRegistry();
    const concurrency = clampConcurrency(options.concurrency, apps.length);

    const results: ParallelDeployResult[] = new Array(apps.length);
    let nextIndex = 0;

    const deployOne = async (index: number): Promise<void> => {
        const app = apps[index];
        try {
            const base = await options.buildRunOptions(app);
            const gate = gates.forAddress(options.signerKey(app));
            const outcome = await runDeploy({
                ...base,
                signingGate: gate,
                onEvent: (event) => options.onEvent?.(app.name, event),
            });
            results[index] = {
                name: app.name,
                domain: outcome.fullDomain,
                status: "success",
                outcome,
            };
        } catch (err) {
            results[index] = {
                name: app.name,
                domain: app.domain,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
            };
        }
        options.onAppSettled?.(results[index]);
    };

    // Worker-pool pattern: spawn `concurrency` runners that pull the next app
    // index until the queue drains. Keeps exactly N builds in flight without a
    // batching stall (a slow app never blocks the next free worker).
    const worker = async (): Promise<void> => {
        while (true) {
            const index = nextIndex;
            if (index >= apps.length) return;
            nextIndex += 1;
            await deployOne(index);
        }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const succeeded = results.filter((r) => r.status === "success").length;
    return { results, succeeded, failed: results.length - succeeded };
}
