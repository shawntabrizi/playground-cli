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
import { Box } from "ink";
import { Header, Row, Section } from "../../utils/ui/theme/index.js";
import { DependencyList } from "./DependencyList.js";
import { IdentityLines } from "./IdentityLines.js";
import { QrLogin } from "./QrLogin.js";
import { AccountSetup } from "./AccountSetup.js";
import { UsernamePrompt } from "./UsernamePrompt.js";
import { computeAllDone } from "./completion.js";
import { VERSION_LABEL } from "../../utils/version.js";
import { getNetworkLabel } from "../../config.js";
import type { LoginHandle, SessionAddresses } from "../../utils/auth.js";

export function InitScreen({
    login,
    existingAddresses,
    onDone,
}: {
    login: LoginHandle | null;
    existingAddresses: SessionAddresses | null;
    onDone: () => void;
}) {
    const needsQr = login !== null;
    const [addresses, setAddresses] = useState<SessionAddresses | null>(existingAddresses);
    const [authResolved, setAuthResolved] = useState(!needsQr);
    const [depsComplete, setDepsComplete] = useState(false);
    const [accountComplete, setAccountComplete] = useState(false);
    const [accountOk, setAccountOk] = useState(true);
    // `null` ≡ "no username on chain and user declined to set one";
    // `string` ≡ "username known (existing or just-claimed)".
    // `undefined` ≡ "prompt has not resolved yet".
    const [username, setUsername] = useState<string | null | undefined>(undefined);

    const allDone = computeAllDone({
        needsQr,
        authResolved,
        loggedInAddress: addresses?.productAddress ?? null,
        depsComplete,
        accountComplete,
        usernameComplete: username !== undefined,
    });

    const handleDepsDone = () => {
        setDepsComplete(true);
    };

    const handleAuthDone = (next: SessionAddresses | null) => {
        if (next) setAddresses(next);
        setAuthResolved(true);
    };

    const handleAccountDone = (success: boolean) => {
        setAccountOk(success);
        setAccountComplete(true);
        // Account setup is a prerequisite for setUsername (the tx needs the
        // smart-contract allowance + a funded product account). When account
        // setup fails we skip the prompt entirely and treat the step as
        // resolved-with-no-username so the init flow can land on
        // "setup complete (with errors)" instead of hanging.
        if (!success) setUsername(null);
    };

    const handleUsernameDone = (next: string | null) => {
        setUsername(next);
    };

    useEffect(() => {
        if (allDone) onDone();
    }, [allDone]);

    return (
        <Box flexDirection="column">
            <Header
                cmd="playground init"
                network={getNetworkLabel()}
                username={username ?? undefined}
                right={VERSION_LABEL}
            />

            {needsQr && <QrLogin login={login} onDone={handleAuthDone} />}

            {addresses && <IdentityLines addresses={addresses} />}

            <DependencyList onDone={handleDepsDone} />

            {addresses && depsComplete && (
                <AccountSetup address={addresses.productAddress} onDone={handleAccountDone} />
            )}

            {addresses && accountComplete && accountOk && (
                <UsernamePrompt addresses={addresses} onDone={handleUsernameDone} />
            )}

            {allDone && (
                <Section gapBelow={false}>
                    <Row
                        mark="ok"
                        label="setup complete"
                        value={accountOk ? undefined : "some account setup steps failed"}
                        tone={accountOk ? "default" : "warning"}
                    />
                </Section>
            )}
        </Box>
    );
}
