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

import { useState, useEffect, useRef } from "react";
import { Row } from "../../utils/ui/theme/index.js";
import {
    waitForLogin,
    type LoginHandle,
    type LoginStatus,
    type SessionAddresses,
} from "../../utils/auth.js";

export function QrLogin({
    login,
    onDone,
}: {
    login: LoginHandle;
    onDone: (addresses: SessionAddresses | null) => void;
}) {
    const [status, setStatus] = useState<LoginStatus>({ step: "waiting" });
    // Snapshot the SessionAddresses from the success status update so the
    // `.then` handler below can hand them to the parent without reading
    // QrLogin's React state. Calling `onDone` inside a `setStatus(updater)`
    // would invoke the parent's `setAddresses` from within React's render
    // phase — that's the "Cannot update a component while rendering a
    // different component" warning we shipped accidentally in #188.
    const addressesRef = useRef<SessionAddresses | null>(null);

    useEffect(() => {
        waitForLogin(login, (next) => {
            setStatus(next);
            if (next.step === "success") {
                addressesRef.current = next.addresses;
            }
        }).then(() => {
            onDone(addressesRef.current);
        });
    }, []);

    if (status.step === "success") {
        // The "logged in" row is rendered by IdentityLines (which also
        // shows username + product account); QrLogin's success path no
        // longer prints its own row to avoid duplicating the address.
        return null;
    }
    if (status.step === "error") {
        return <Row mark="fail" label="login failed" value={status.message} tone="danger" />;
    }
    if (status.step === "paired") {
        return <Row mark="run" label="sign in" value="paired, finalizing…" tone="muted" />;
    }
    if (status.step === "pending") {
        return <Row mark="run" label="sign in" value={status.stage} tone="muted" />;
    }
    return <Row mark="run" label="sign in" value="scan QR with the Polkadot app" tone="muted" />;
}
