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
 * Test template app setup and fixture project paths.
 */

import { resolve } from "node:path";

/** Absolute path to fixture projects directory. */
export const FIXTURES_DIR = resolve(import.meta.dirname, "projects");

/** Pre-registered test domain, read from env. */
export const TEST_DOMAIN = process.env.TEST_TEMPLATE_DOMAIN ?? "";

/** GitHub repo URL for the test template domain. */
export const TEST_REPO = process.env.TEST_TEMPLATE_REPO ?? "";

/** Get the absolute path to a fixture project. */
export function fixturePath(name: string): string {
	return resolve(FIXTURES_DIR, name);
}
