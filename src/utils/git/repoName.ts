import { randomBytes } from "node:crypto";

/**
 * Build the default target-directory name for `dot mod`: a slugified domain
 * with a short random suffix so repeated mods of the same app don't collide.
 */
export function defaultRepoName(domain: string): string {
    return slugify(domain.replace(/\.dot$/, "")) + "-" + randomBytes(3).toString("hex");
}

function slugify(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}
