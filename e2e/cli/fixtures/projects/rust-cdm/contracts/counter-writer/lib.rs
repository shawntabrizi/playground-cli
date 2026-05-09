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

#![no_main]
#![no_std]

use pvm_contract as pvm;

#[pvm::contract(cdm = "@example/counter-writer")]
mod counter_writer {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Ok(())
    }

    /// Increment the shared counter by calling the counter contract via CDM
    #[pvm::method]
    pub fn write_increment() {
        let counter = counter::cdm_reference();
        counter.increment().expect("increment failed");
    }

    /// Increment the shared counter N times
    #[pvm::method]
    pub fn write_increment_n(n: u32) {
        let counter = counter::cdm_reference();
        for _ in 0..n {
            counter.increment().expect("increment failed");
        }
    }
}
