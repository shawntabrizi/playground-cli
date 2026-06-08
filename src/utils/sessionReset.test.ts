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

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAPP_ID } from "../config.js";
import { resetDeviceIdentityForFreshPairing } from "./sessionReset.js";

const p = (key: string) => `${DAPP_ID}_${key}.json`;

describe("resetDeviceIdentityForFreshPairing", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "session-reset-test-"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    async function seed(files: Record<string, string>) {
        await Promise.all(
            Object.entries(files).map(([name, body]) => writeFile(join(dir, name), body, "utf-8")),
        );
    }
    async function remaining(): Promise<string[]> {
        return (await readdir(dir)).sort();
    }

    it("rotates the device identity and session list, preserving everything else", async () => {
        // The poisoned-topic fingerprint: DeviceIdentity + an emptied
        // (0x00) session list, with orphaned secrets and a cached slot key.
        await seed({
            [p("DeviceIdentity")]: "0xdeadbeef",
            [p("SsoSessionsV2")]: "0x00",
            [p("AllowanceKeys")]: '{"bulletin":"0xkey"}',
            [p("LoginStamp")]: '{"at":1}',
            [p("UserSecretsV2_abc")]: "0xsecret",
            [p("sso_processed_abc")]: '["msg"]',
        });

        await resetDeviceIdentityForFreshPairing(dir);

        // DeviceIdentity (the host half of the topic key) and the session list
        // it is bound to are gone, so the next pairing derives a fresh topic.
        expect(await remaining()).toEqual(
            [
                p("AllowanceKeys"),
                p("LoginStamp"),
                p("UserSecretsV2_abc"),
                p("sso_processed_abc"),
            ].sort(),
        );
    });

    it("never deletes the cached allowance slot keys", async () => {
        // AllowanceKeys holds the Bulletin/SSS slot private keys; deleting them
        // would burn phone-granted quota to re-request. They are not part of the
        // session topic, so rotation must leave them alone.
        await seed({
            [p("DeviceIdentity")]: "0xid",
            [p("AllowanceKeys")]: '{"bulletin":"0xkey"}',
        });

        await resetDeviceIdentityForFreshPairing(dir);

        expect(await remaining()).toEqual([p("AllowanceKeys")]);
    });

    it("ignores files from other apps and non-session keys", async () => {
        await seed({
            "other-app_DeviceIdentity.json": "0xother",
            [p("DeviceIdentity")]: "0xid",
        });

        await resetDeviceIdentityForFreshPairing(dir);

        expect(await remaining()).toEqual(["other-app_DeviceIdentity.json"]);
    });

    it("is a no-op (no throw) when the storage directory does not exist", async () => {
        await expect(
            resetDeviceIdentityForFreshPairing(join(dir, "does-not-exist")),
        ).resolves.toBeUndefined();
    });
});
