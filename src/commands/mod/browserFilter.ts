export interface AppEntry {
    domain: string;
    name: string | null;
    description: string | null;
    repository: string | null;
}

export function filterModable(apps: AppEntry[], modableOnly: boolean): AppEntry[] {
    if (!modableOnly) return apps;
    return apps.filter((a) => Boolean(a.repository));
}
