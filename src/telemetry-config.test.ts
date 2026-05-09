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

import { describe, expect, it } from "vitest";
import {
    configureBulletinTelemetryEnv,
    extractRepoSlug,
    getCliRootAttributes,
    isInternalContextFromSignals,
    resolveTelemetryEnabled,
    sanitizeBranch,
    sanitizeRepo,
    scrubPaths,
    truncateAddress,
} from "./telemetry-config.js";

describe("telemetry enablement", () => {
    it("DOT_TELEMETRY=0 always disables", () => {
        expect(
            resolveTelemetryEnabled(
                { DOT_TELEMETRY: "0", GITHUB_REPOSITORY: "paritytech/playground-cli" },
                {},
            ),
        ).toBe(false);
    });

    it("DOT_TELEMETRY=1 always enables", () => {
        expect(resolveTelemetryEnabled({ DOT_TELEMETRY: "1" }, {})).toBe(true);
    });

    it("enables for internal GitHub repositories when DOT_TELEMETRY is unset", () => {
        expect(
            resolveTelemetryEnabled({ GITHUB_REPOSITORY: "paritytech/playground-cli" }, {}),
        ).toBe(true);
        expect(resolveTelemetryEnabled({ GITHUB_REPOSITORY: "w3f/app" }, {})).toBe(true);
        expect(resolveTelemetryEnabled({ GITHUB_REPOSITORY: "polkadot-fellows/tool" }, {})).toBe(
            true,
        );
    });

    it("enables for parity self-hosted runners when DOT_TELEMETRY is unset", () => {
        expect(resolveTelemetryEnabled({ RUNNER_NAME: "parity-linux-1" }, {})).toBe(true);
    });

    it("enables for internal git remotes when DOT_TELEMETRY is unset", () => {
        expect(resolveTelemetryEnabled({}, { gitRemote: "paritytech/playground-cli" })).toBe(true);
    });

    it("stays disabled for unknown external contexts", () => {
        expect(resolveTelemetryEnabled({}, { gitRemote: "some-user/private-app" })).toBe(false);
    });

    it("exposes internal context signal detection for callers that already resolved signals", () => {
        expect(isInternalContextFromSignals({ gitRemote: "w3f/app" })).toBe(true);
        expect(isInternalContextFromSignals({ gitRemote: "someone/app" })).toBe(false);
    });
});

describe("bulletin env mapping", () => {
    it("sets ambient host vars and disables bulletin telemetry for external unset context", () => {
        const env: Record<string, string | undefined> = {};
        configureBulletinTelemetryEnv(env, { gitRemote: "some-user/private-app" });
        expect(env.BULLETIN_DEPLOY_USE_AMBIENT_SENTRY).toBe("1");
        expect(env.BULLETIN_DEPLOY_HOST_APP).toBe("playground-cli");
        expect(env.BULLETIN_DEPLOY_TELEMETRY).toBe("0");
        expect(env.BULLETIN_DEPLOY_MEM_REPORT).toBeUndefined();
    });

    it("enables bulletin telemetry when DOT_TELEMETRY=1", () => {
        const env: Record<string, string | undefined> = { DOT_TELEMETRY: "1" };
        configureBulletinTelemetryEnv(env, {});
        expect(env.BULLETIN_DEPLOY_TELEMETRY).toBe("1");
    });

    it("preserves explicit bulletin env values", () => {
        const env: Record<string, string | undefined> = {
            DOT_TELEMETRY: "1",
            BULLETIN_DEPLOY_USE_AMBIENT_SENTRY: "0",
            BULLETIN_DEPLOY_HOST_APP: "custom-host",
            BULLETIN_DEPLOY_TELEMETRY: "0",
            BULLETIN_DEPLOY_MEM_REPORT: "0",
        };
        configureBulletinTelemetryEnv(env, {});
        expect(env.BULLETIN_DEPLOY_USE_AMBIENT_SENTRY).toBe("0");
        expect(env.BULLETIN_DEPLOY_HOST_APP).toBe("custom-host");
        expect(env.BULLETIN_DEPLOY_TELEMETRY).toBe("0");
        expect(env.BULLETIN_DEPLOY_MEM_REPORT).toBe("0");
    });
});

describe("sanitizers", () => {
    it("scrubs macOS and Linux home paths", () => {
        expect(scrubPaths("/Users/alice/project failed")).toBe("/Users/<redacted>/project failed");
        expect(scrubPaths("/home/bob/project failed")).toBe("/home/<redacted>/project failed");
    });

    it("sanitizes conventional and user-prefixed branch names", () => {
        expect(sanitizeBranch("feat/telemetry")).toBe("feat/telemetry");
        expect(sanitizeBranch("alice/secret-project")).toBe("secret-project");
        expect(sanitizeBranch("main")).toBe("main");
    });

    it("sanitizes external repo slugs but preserves internal orgs", () => {
        expect(sanitizeRepo("paritytech/playground-cli")).toBe("paritytech/playground-cli");
        expect(sanitizeRepo("some-user/private-project")).toMatch(/^some-user\/[a-f0-9]{12}$/);
        expect(sanitizeRepo("private-project")).toMatch(/^ext\/[a-f0-9]{12}$/);
    });

    it("truncates addresses", () => {
        expect(truncateAddress("5FHneW46xGXgs5mUive")).toBe("5FHneW46...");
        expect(truncateAddress("short")).toBe("short");
        expect(truncateAddress(undefined)).toBeUndefined();
    });

    it("extracts GitHub repo slugs from common remote URL forms", () => {
        expect(extractRepoSlug("git@github.com:paritytech/playground-cli.git")).toBe(
            "paritytech/playground-cli",
        );
        expect(extractRepoSlug("https://github.com/paritytech/playground-cli.git")).toBe(
            "paritytech/playground-cli",
        );
    });
});

describe("root attributes", () => {
    it("builds stable cli attributes with sad and expected seeded as strings", () => {
        const attrs = getCliRootAttributes(
            "deploy",
            { DOT_TAG: "e2e-local-smoke" },
            { gitRemote: "paritytech/playground-cli", branch: "feat/telemetry" },
        );
        expect(attrs["cli.command"]).toBe("deploy");
        expect(attrs["cli.repo"]).toBe("paritytech/playground-cli");
        expect(attrs["cli.branch"]).toBe("feat/telemetry");
        expect(attrs["cli.sad"]).toBe("false");
        expect(attrs["cli.expected"]).toBe("false");
        expect(attrs["cli.tag"]).toBe("e2e-local-smoke");
    });
});
