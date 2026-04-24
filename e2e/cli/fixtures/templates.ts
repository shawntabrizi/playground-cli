/**
 * Test template app setup and fixture project paths.
 */

import { resolve } from "node:path";

/** Absolute path to fixture projects directory. */
export const FIXTURES_DIR = resolve(import.meta.dirname, "projects");

/** Pre-registered test domain, read from env. */
export const TEST_DOMAIN = process.env.TEST_TEMPLATE_DOMAIN ?? "";

/** GitHub repo URL for the test template domain. */
export const TEST_REPO = process.env.TEST_TEMPLATE_REPO ?? "";

/** Get the absolute path to a fixture project. */
export function fixturePath(name: string): string {
	return resolve(FIXTURES_DIR, name);
}
