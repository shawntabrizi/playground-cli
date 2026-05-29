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

import { useEffect, useState, type ReactNode } from "react";
import { Box, Text, render } from "ink";
import {
    installContracts,
    type InstallContractsOptions,
    type InstallEvent,
    type InstallResult,
    type InstallSummary,
} from "@dotdm/contracts";
import { getNetworkLabel } from "../config.js";
import { COLOR, GLYPH, Header, Mark, Row, Section, TIMING } from "../utils/ui/theme/index.js";
import { VERSION_LABEL } from "../utils/version.js";

const COL_CONTRACT = 24;
const COL_VERSION = 10;
const COL_METADATA = 10;
const COL_ADDRESS = 14;

type InstallState = "waiting" | "querying" | "fetching" | "done" | "error";

interface InstallStatus {
    library: string;
    state: InstallState;
    error?: string;
    version?: number;
    address?: string;
    metadataCid?: string;
    savedPath?: string;
}

export interface ContractInstallUiOptions extends Omit<InstallContractsOptions, "onEvent"> {
    registryAddress: string;
    assethubUrl: string;
    ipfsGatewayUrl: string;
}

export interface ContractInstallUiResult {
    summary: InstallSummary;
    success: boolean;
}

class ContractInstallStatusAdapter {
    readonly statuses = new Map<string, InstallStatus>();

    constructor(libraries: string[]) {
        for (const library of libraries) {
            this.statuses.set(library, { library, state: "waiting" });
        }
    }

    handleEvent = (event: InstallEvent) => {
        switch (event.type) {
            case "install-start":
                this.update(event.library, "waiting");
                return;
            case "query-start":
                this.update(event.library, "querying");
                return;
            case "query-done":
                this.update(event.library, "fetching", {
                    version: event.version,
                    address: event.address,
                    metadataCid: event.metadataCid,
                });
                return;
            case "fetch-start":
                this.update(event.library, "fetching", { metadataCid: event.metadataCid });
                return;
            case "install-done":
                this.update(event.library, "done", {
                    version: event.result.version,
                    address: event.result.address,
                    metadataCid: event.result.metadataCid,
                    savedPath: event.result.savedPath,
                });
                return;
            case "install-error":
                this.update(event.library, "error", { error: event.error });
                return;
            case "pipeline-done":
            case "pipeline-error":
                return;
        }
    };

    private update(library: string, state: InstallState, extra?: Partial<InstallStatus>) {
        const current = this.statuses.get(library) ?? { library, state: "waiting" };
        this.statuses.set(library, { ...current, state, ...extra });
    }
}

export async function runContractInstallWithUI(
    opts: ContractInstallUiOptions,
): Promise<ContractInstallUiResult> {
    const { registryAddress, assethubUrl, ipfsGatewayUrl, ...installOpts } = opts;
    const libraries = installOpts.libraries.map((entry) => entry.library);
    const adapter = new ContractInstallStatusAdapter(libraries);

    const app = render(
        <ContractInstallScreen
            adapter={adapter}
            libraries={libraries}
            registryAddress={registryAddress}
            assethubUrl={assethubUrl}
            ipfsGatewayUrl={ipfsGatewayUrl}
        />,
    );

    let summary: InstallSummary;
    try {
        summary = await installContracts({
            ...installOpts,
            onEvent: adapter.handleEvent,
        });
    } finally {
        await new Promise((resolve) => setTimeout(resolve, 200));
        app.unmount();
    }

    return { summary, success: summary.success };
}

function ContractInstallScreen({
    adapter,
    libraries,
    registryAddress,
    assethubUrl,
    ipfsGatewayUrl,
}: {
    adapter: ContractInstallStatusAdapter;
    libraries: string[];
    registryAddress: string;
    assethubUrl: string;
    ipfsGatewayUrl: string;
}) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => setTick((current) => current + 1), TIMING.spinnerMs);
        return () => clearInterval(timer);
    }, []);

    return (
        <Box flexDirection="column">
            <Header
                cmd="playground contract install"
                subtitle="cdm contracts"
                network={getNetworkLabel()}
                right={VERSION_LABEL}
            />
            <Section gapBelow={false}>
                <Row label="asset hub" value={assethubUrl} tone="muted" />
                <Row label="registry" value={registryAddress} tone="muted" />
                <Row label="gateway" value={ipfsGatewayUrl} tone="muted" />
            </Section>
            <InstallTable
                statuses={adapter.statuses}
                libraries={libraries}
                ipfsGatewayUrl={ipfsGatewayUrl}
                tick={tick}
            />
        </Box>
    );
}

function InstallTable({
    statuses,
    libraries,
    ipfsGatewayUrl,
    tick,
}: {
    statuses: Map<string, InstallStatus>;
    libraries: string[];
    ipfsGatewayUrl: string;
    tick: number;
}) {
    const errors = libraries
        .map((library) => statuses.get(library))
        .filter((status): status is InstallStatus & { error: string } =>
            Boolean(status?.state === "error" && status.error),
        );

    return (
        <Box flexDirection="column" marginTop={1}>
            <HeaderRow />
            {libraries.map((library) => (
                <InstallRow
                    key={library}
                    library={library}
                    status={statuses.get(library)}
                    ipfsGatewayUrl={ipfsGatewayUrl}
                    tick={tick}
                />
            ))}
            {errors.length > 0 && (
                <Box flexDirection="column" marginTop={1}>
                    {errors.map((status) => (
                        <Row
                            key={status.library}
                            mark="fail"
                            label={status.library}
                            value={status.error}
                            tone="danger"
                        />
                    ))}
                </Box>
            )}
        </Box>
    );
}

function HeaderRow() {
    return (
        <Box paddingLeft={2}>
            <Cell width={COL_CONTRACT}>
                <Text dimColor>contract</Text>
            </Cell>
            <Cell width={COL_VERSION}>
                <Text dimColor>version</Text>
            </Cell>
            <Cell width={COL_METADATA}>
                <Text dimColor>metadata</Text>
            </Cell>
            <Cell width={COL_ADDRESS}>
                <Text dimColor>address</Text>
            </Cell>
        </Box>
    );
}

function InstallRow({
    library,
    status,
    ipfsGatewayUrl,
    tick,
}: {
    library: string;
    status: InstallStatus | undefined;
    ipfsGatewayUrl: string;
    tick: number;
}) {
    return (
        <Box paddingLeft={2}>
            <Cell width={COL_CONTRACT}>
                <Text bold wrap="truncate">
                    {library}
                </Text>
            </Cell>
            <Cell width={COL_VERSION}>{versionCell(status, tick)}</Cell>
            <Cell width={COL_METADATA}>{metadataCell(status, ipfsGatewayUrl, tick)}</Cell>
            <Cell width={COL_ADDRESS}>
                {status?.address ? (
                    <Text dimColor>{truncateAddress(status.address)}</Text>
                ) : (
                    <Idle />
                )}
            </Cell>
        </Box>
    );
}

function versionCell(status: InstallStatus | undefined, tick: number) {
    const state = status?.state ?? "waiting";
    if (state === "querying") return <Spinner tick={tick} />;
    if (state === "error" && status?.version === undefined) return <Mark kind="fail" />;
    if (status?.version !== undefined) return <Text color={COLOR.success}>v{status.version}</Text>;
    return <Idle />;
}

function metadataCell(status: InstallStatus | undefined, ipfsGatewayUrl: string, tick: number) {
    const state = status?.state ?? "waiting";
    if (state === "fetching") return <Spinner tick={tick} />;
    if (state === "error" && status?.version !== undefined && !status.metadataCid) {
        return <Mark kind="fail" />;
    }
    if (status?.metadataCid) {
        return (
            <HashText
                value={status.metadataCid}
                url={ipfsUrl(ipfsGatewayUrl, status.metadataCid)}
            />
        );
    }
    return <Idle />;
}

function Spinner({ tick }: { tick: number }) {
    return <Text color={COLOR.warning}>{GLYPH.spinner[tick % GLYPH.spinner.length]}</Text>;
}

function Idle() {
    return <Text dimColor>{GLYPH.pending}</Text>;
}

function HashText({ value, url }: { value: string; url?: string }) {
    const label = <Text color={COLOR.success}>{shortHash(value)}</Text>;
    return url ? <Link url={url}>{label}</Link> : label;
}

function Cell({ children, width }: { children: ReactNode; width?: number }) {
    return (
        <Box width={width} marginRight={1}>
            {children}
        </Box>
    );
}

function shortHash(value: string): string {
    if (value.startsWith("0x")) return value.slice(2, 6);
    return value.slice(-4);
}

function truncateAddress(address: string): string {
    return address.length <= 12 ? address : `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function Link({ url, children }: { url: string; children: ReactNode }) {
    return (
        <Text>
            {`\x1b]8;;${url}\x07`}
            {children}
            {"\x1b]8;;\x07"}
        </Text>
    );
}

function ipfsUrl(gatewayUrl: string, cid: string): string {
    return `${gatewayUrl.replace(/\/+$/, "")}/${cid.replace(/^\/+/, "")}`;
}
