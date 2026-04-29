import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

/**
 * Build the default target-directory / fork name for `dot mod`: a slugified
 * domain with a short random suffix so repeated mods of the same app don't
 * collide. The random suffix matches GitHub's own `fork-name` conflict
 * handling — nothing explodes if two users happen to race on the same fork.
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

/**
 * Validate a name supplied for --repo-name or entered in the repo-name prompt.
 * The rules mirror GitHub's repository name constraints (letters, digits,
 * `.`, `-`, `_`, not leading with `.` or `-`) and additionally reject names
 * that would collide with an existing directory in the current working tree.
 *
 * Returns an error message, or `null` when the name is usable.
 */
export function validateRepoName(name: string): string | null {
    if (!name) return "repository name is required";
    if (name.length > 100) return "repository name is too long (max 100 chars)";
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
        return "repository name may only contain letters, digits, '.', '-', '_'";
    }
    if (/^[-.]/.test(name)) return "repository name cannot start with '.' or '-'";
    if (existsSync(name)) return `directory "${name}" already exists`;
    return null;
}
