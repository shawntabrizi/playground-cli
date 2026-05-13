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

import { useState, useEffect } from "react";
import { Row } from "../../utils/ui/theme/index.js";
import { waitForLogin, type LoginStatus, type LoginHandle } from "../../utils/auth.js";

export function QrLogin({
    login,
    onDone,
}: {
    login: LoginHandle;
    onDone: (address: string | null) => void;
}) {
    const [status, setStatus] = useState<LoginStatus>({ step: "waiting" });

    useEffect(() => {
        waitForLogin(login, setStatus).then(onDone);
    }, []);

    if (status.step === "success") {
        return <Row mark="ok" label="logged in" value={status.address} tone="muted" />;
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
