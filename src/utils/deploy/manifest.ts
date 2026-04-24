import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HexString } from "polkadot-api";
import type { DeployOutcome } from "./run.js";

/**
 * Machine-readable manifest emitted at the end of `dot deploy` when
 * `--manifest <path>` is set. Stable, versioned contract for downstream
 * tooling (CIs, template generators, package scripts) that wants to pick up
 * deployed contract addresses and CIDs without parsing the TUI.
 */
export interface DeployManifest {
    /** Schema version; bump on any breaking change to field names/semantics. */
    version: 1;
    /** Canonical `<label>.dot` name. */
    fullDomain: string;
    /** Resolvable URL the app is live at. */
    appUrl: string;
    /** Bulletin Chain CID of the app bundle. */
    appCid: string;
    /** IPFS CID of the directory root, if computed. */
    ipfsCid?: string;
    /** Metadata CID when the deploy also published to Playground. */
    metadataCid?: string;
    /** Deployed contracts, in the order they were compiled and deployed. */
    contracts: Array<{ name: string; address: HexString }>;
}

export function buildManifest(outcome: DeployOutcome): DeployManifest {
    const manifest: DeployManifest = {
        version: 1,
        fullDomain: outcome.fullDomain,
        appUrl: outcome.appUrl,
        appCid: outcome.appCid,
        contracts: outcome.contracts.map((c) => ({ name: c.name, address: c.address })),
    };
    if (outcome.ipfsCid !== undefined) manifest.ipfsCid = outcome.ipfsCid;
    if (outcome.metadataCid !== undefined) manifest.metadataCid = outcome.metadataCid;
    return manifest;
}

/** Write a manifest to disk, creating parent directories as needed. */
export function writeManifest(path: string, manifest: DeployManifest): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
