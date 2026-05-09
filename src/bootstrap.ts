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

// Env-var wiring that MUST be applied before any `bulletin-deploy` module
// evaluates. ES-module top-level evaluation is dependency-first + ordered
// across siblings of the same parent, so importing this module as the very
// first statement in `src/index.ts` guarantees its side effects run before
// bulletin-deploy initialises its telemetry gates. Plain `process.env.X`
// assignments later in `index.ts` are too late because import hoisting would
// have already evaluated the bulletin-deploy import chain.
//
// The CLI owns the Sentry SDK and hands the active client to bulletin-deploy
// through ambient mode. `DOT_TELEMETRY` remains the privacy gate for both apps:
// unknown external users stay off by default, while known internal contexts
// and explicit `DOT_TELEMETRY=1` opt in. Do not set
// `BULLETIN_DEPLOY_HOST_APP=playground-cli` without also setting an explicit
// `BULLETIN_DEPLOY_TELEMETRY` value; bulletin-deploy treats this host app as
// internal.

import { configureBulletinTelemetryEnv } from "./telemetry-config.js";

// Forces ESM module semantics on this otherwise-import-free file. Without it,
// TS classifies the file as a script and `await import("./bootstrap.js")`
// resolves to `{ default: undefined }` with no export binding — TS2306 at
// every callsite in `bootstrap.test.ts`. Keep.
export {};

configureBulletinTelemetryEnv();
