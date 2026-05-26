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

import { Row, Section } from "../../utils/ui/theme/index.js";
import type { SessionAddresses } from "../../utils/auth.js";
import { PLAYGROUND_PRODUCT_ID } from "../../config.js";

/**
 * Two-row identity block shown after a successful login:
 *
 *   logged in        <wallet root SS58>
 *   account in use   playground.dot/0 — <product 0x H160> · <product SS58>
 *
 * `logged in` is the SSO-handshake `rootAccountId` (bare-mnemonic on
 * current mobile builds). It is NOT the same address mobile shows as
 * "Wallet account" on its debug screen — that uses the hard `//wallet`
 * derivation which the host can't reproduce.
 *
 * `account in use` is a single row that surfaces all three views of
 * the playground product account: the derivation slug, the H160 (what
 * Revive sees as `caller()` and what playground-app displays), and the
 * SS58 (what subscan / wallet tooling shows). Two earlier rows
 * (`account in use` + `product account`) showed the H160 and SS58
 * separately — same key, two encodings — which read as "two accounts"
 * to users. Collapsed here.
 *
 * The user's registry username is intentionally NOT rendered here — it
 * lives in the top breadcrumb (see `Header`'s `username` prop) so it
 * stays visible across every screen in the command. `UsernamePrompt`
 * owns the read + write path; this component is purely the address
 * pair now.
 *
 * The SS58 + H160 are taken straight off the auth-derived pair so
 * they never drift — the bug we had previously was running
 * `deriveProductAccountPublicKey` again on the already-derived SS58
 * and producing a doubly-derived ghost address.
 */
export function IdentityLines({ addresses }: { addresses: SessionAddresses }) {
    return (
        <Section>
            <Row mark="ok" label="logged in" value={addresses.rootAddress} tone="muted" />
            <Row
                mark="ok"
                label="account in use"
                value={`${PLAYGROUND_PRODUCT_ID}/0 — ${addresses.productH160} · ${addresses.productAddress}`}
                tone="muted"
            />
        </Section>
    );
}
