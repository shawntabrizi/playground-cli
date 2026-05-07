export interface AppEntry {
    domain: string;
    name: string | null;
    description: string | null;
    repository: string | null;
    /**
     * Default branch the app was deployed from. Present iff the publisher
     * was on a CLI that wrote `meta.branch` (≥ this PR). Carried through
     * to `SetupScreen` so the picker path can build the codeload tarball
     * URL without re-fetching the IPFS metadata; missing values fall back
     * to `"main"`.
     */
    branch: string | null;
    tag: string | null;
}

export function filterModdable(apps: AppEntry[], moddableOnly: boolean): AppEntry[] {
    if (!moddableOnly) return apps;
    return apps.filter((a) => Boolean(a.repository));
}
