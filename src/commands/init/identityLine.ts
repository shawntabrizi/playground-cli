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
 * Pure helpers for the identity block in InitScreen — lifted out of the
 * `.tsx` per the repo convention "pure logic that lives inside a `.tsx`
 * component should be lifted into a sibling `.ts` file" (see
 * `completion.ts` next to `InitScreen.tsx` for the same pattern).
 */

import { deriveH160, ss58Decode } from "@parity/product-sdk-address";

export interface ProductAccountAddresses {
    ss58: string;
    h160: `0x${string}`;
}

export function productAccountAddresses(productAccountSs58: string): ProductAccountAddresses {
    const { publicKey } = ss58Decode(productAccountSs58);
    return {
        ss58: productAccountSs58,
        h160: deriveH160(publicKey),
    };
}

export function productAccountDisplay(productAccountSs58: string): string {
    const { ss58, h160 } = productAccountAddresses(productAccountSs58);
    return `${ss58} (${h160})`;
}
