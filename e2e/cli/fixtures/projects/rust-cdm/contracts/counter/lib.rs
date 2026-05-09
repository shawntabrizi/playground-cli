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

use pvm::storage::Lazy;
use pvm_contract as pvm;

#[pvm::storage]
struct Storage {
    count: u32,
}

#[pvm::contract(cdm = "@example/counter")]
mod counter {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Storage::count().set(&0);
        Ok(())
    }

    #[pvm::method]
    pub fn increment() {
        let current = Storage::count().get().unwrap_or(0);
        Storage::count().set(&(current + 1));
    }

    #[pvm::method]
    pub fn get_count() -> u32 {
        Storage::count().get().unwrap_or(0)
    }
}
