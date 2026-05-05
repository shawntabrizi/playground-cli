#!/usr/bin/env bun
/**
 * Enumerate apps on the live playground-registry contract on Paseo Asset Hub,
 * and check whether each one's `metadata.repository` is reachable as a public
 * GitHub repo. Useful for picking a stable e2e test target for `dot mod`.
 *
 * Usage:
 *   bun tools/list-registry-apps.ts
 */

import { ContractManager, type CdmJson } from "@polkadot-apps/contracts";
import { createDevSigner, getDevPublicKey } from "@polkadot-apps/tx";
import { ss58Encode } from "@polkadot-apps/address";
import { getGateway, fetchJson } from "@polkadot-apps/bulletin";
import type { HexString } from "polkadot-api";
import { getConnection, destroyConnection } from "../src/utils/connection.js";
import {
    PLAYGROUND_REGISTRY_CONTRACT,
    withRequiredLiveContractAddresses,
    withoutReviveTraceNoise,
} from "../src/utils/contractManifest.js";
import cdmJson from "../cdm.json";

interface AppMetadata {
    name?: string;
    description?: string;
    repository?: string;
    branch?: string;
}

interface RegistryEntry {
    domain: string;
    metadata_uri: string;
    owner: HexString;
}

async function probePublicGithub(repoUrl: string): Promise<{ ok: boolean; status: number }> {
    const match = repoUrl.match(/github\.com[:/]+([^/]+)\/([^/.]+)/);
    if (!match) return { ok: false, status: 0 };
    const [, owner, repo] = match;
    // HEAD on the HTML page rather than a GET on `api.github.com` — same
    // 200/404 signal, but doesn't consume GitHub's 60/hour anonymous-IP
    // API quota. Mirrors `src/utils/deploy/modable.ts::assertPublicGitHubRepo`
    // so a maintainer running this tool burns the same kind of probe their
    // CLI does at modable-preflight time.
    const res = await fetch(`https://github.com/${owner}/${repo}`, { method: "HEAD" });
    return { ok: res.ok, status: res.status };
}

async function main(): Promise<number> {
    const client = await getConnection();
    try {
        const manifest = await withRequiredLiveContractAddresses(
            cdmJson as unknown as CdmJson,
            client.raw.assetHub,
        );
        const aliceSigner = createDevSigner("Alice");
        const aliceAddress = ss58Encode(getDevPublicKey("Alice"));
        const manager = await ContractManager.fromClient(manifest, client.raw.assetHub, {
            defaultSigner: aliceSigner,
            defaultOrigin: aliceAddress,
        });
        const registry = manager.getContract(PLAYGROUND_REGISTRY_CONTRACT);

        const res = await withoutReviveTraceNoise(() => registry.getApps.query(0, 100));
        const value = res.value as { entries: RegistryEntry[]; total: number };
        console.log(`live registry has ${value.total} app(s); inspecting up to 100:\n`);

        const gateway = getGateway("paseo");
        for (const entry of value.entries) {
            let meta: AppMetadata = {};
            let metaErr = "";
            try {
                meta = await fetchJson<AppMetadata>(entry.metadata_uri, gateway);
            } catch (e) {
                metaErr = e instanceof Error ? e.message.slice(0, 60) : String(e).slice(0, 60);
            }
            const repo = meta.repository ?? "";
            let probe = "—";
            if (repo) {
                try {
                    const r = await probePublicGithub(repo);
                    probe = r.ok ? "PUBLIC ✓" : `${r.status}`;
                } catch {
                    probe = "fetch-err";
                }
            }
            console.log(
                `  ${entry.domain.padEnd(36)}  repo=${(repo || metaErr || "<no repo>").padEnd(60)}  github=${probe}`,
            );
        }
        return 0;
    } finally {
        destroyConnection();
    }
}

main()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
        process.exit(2);
    });
