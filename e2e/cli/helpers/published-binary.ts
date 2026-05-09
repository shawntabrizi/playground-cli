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
 * Resolves the path to the `dot` binary for E2E tests against a published
 * artefact. When `DOT_E2E_BINARY` is set, return that path (tests run against
 * the SEA binary). Otherwise return null and the caller should use the
 * source-build path via dot.ts.
 */
export function getPublishedBinaryPath(): string | null {
	return process.env.DOT_E2E_BINARY ?? null;
}
