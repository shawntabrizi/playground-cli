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
 * Public surface for build detection + execution.
 *
 * Kept free of React/Ink imports so this module can be consumed from a
 * WebContainer (RevX) as well as the Node CLI.
 */

export {
    detectBuildConfig,
    detectContractsType,
    detectInstallConfig,
    detectPackageManager,
    BuildDetectError,
    PM_LOCKFILES,
    type BuildConfig,
    type ContractsType,
    type DetectInput,
    type InstallConfig,
    type PackageManager,
} from "./detect.js";
export { loadDetectInput, runBuild, type RunBuildOptions, type RunBuildResult } from "./runner.js";
