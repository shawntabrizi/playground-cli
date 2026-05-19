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

import { useEffect, useState } from "react";
import { Row, Section } from "../../utils/ui/theme/index.js";
import { formatUsernameLine, lookupUsername, type UsernameLookup } from "../../utils/username.js";
import { productAccountDisplay } from "./identityLine.js";

/**
 * Two-line identity block shown after a successful login:
 *
 *   username        alice.dot
 *   product account <full ss58> (<full 0x h160>)
 *
 * Both the SS58 and the 0x H160 are printed in full so the user can copy
 * them directly. The username lookup is async (queries People parachain)
 * and has a 10s timeout inside `lookupUsername`; the product account is
 * synchronous (pure sr25519 soft derivation). A `(looking up...)`
 * placeholder renders while the lookup is in flight; failures and missing
 * identities fall through to the relevant fallback strings from
 * `formatUsernameLine`.
 */
export function IdentityLines({ address }: { address: string }) {
    const [username, setUsername] = useState<UsernameLookup>({ kind: "loading" });

    useEffect(() => {
        let cancelled = false;
        lookupUsername(address).then((result) => {
            if (!cancelled) setUsername(result);
        });
        return () => {
            cancelled = true;
        };
    }, [address]);

    const usernameTone = username.kind === "found" ? "default" : "muted";

    return (
        <Section>
            <Row
                mark="ok"
                label="username"
                value={formatUsernameLine(username)}
                tone={usernameTone}
            />
            <Row
                mark="ok"
                label="product account"
                value={productAccountDisplay(address)}
                tone="muted"
            />
        </Section>
    );
}
