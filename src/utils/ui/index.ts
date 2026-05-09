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
 * Public TUI surface: re-exports the theme plug (the visual system) and
 * the shared StepRunner (the sequential-steps runner built on top of it).
 *
 * Screens import everything they need from this module. The theme itself
 * lives in `./theme/` — edit that directory to change the look.
 */

export * from "./theme/index.js";
export { StepRunner, type Step, type StepRunnerResult } from "./components/StepRunner.js";
