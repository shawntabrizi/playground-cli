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

import type { CdmJson } from "@parity/product-sdk-contracts";

export type CdmTargetWithRegistry = CdmJson["targets"][string] & { registry?: string };

export function defaultCdmTargetHash(manifest: Pick<CdmJson, "targets">): string {
    const [targetHash] = Object.keys(manifest.targets);
    if (!targetHash) throw new Error("No targets found in cdm.json");
    return targetHash;
}

export function defaultCdmTarget(manifest: Pick<CdmJson, "targets">): CdmTargetWithRegistry {
    return manifest.targets[defaultCdmTargetHash(manifest)] as CdmTargetWithRegistry;
}
