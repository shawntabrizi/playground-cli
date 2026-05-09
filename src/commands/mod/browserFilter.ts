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

export interface AppEntry {
    domain: string;
    name: string | null;
    description: string | null;
    repository: string | null;
    /**
     * Default branch the app was deployed from. Present iff the publisher
     * was on a CLI that wrote `meta.branch` (≥ this PR). Carried through
     * to `SetupScreen` so the picker path can build the codeload tarball
     * URL without re-fetching the IPFS metadata; missing values fall back
     * to `"main"`.
     */
    branch: string | null;
    tag: string | null;
}

export function filterModdable(apps: AppEntry[], moddableOnly: boolean): AppEntry[] {
    if (!moddableOnly) return apps;
    return apps.filter((a) => Boolean(a.repository));
}
