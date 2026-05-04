import { describe, test, expect } from "vitest";
import { dot } from "./helpers/dot.js";

describe("dot install", () => {
	test("dot --version returns a semver version string", async () => {
		const result = await dot(["--version"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
	});

	test("dot --help lists all subcommands", async () => {
		const result = await dot(["--help"]);
		expect(result.exitCode).toBe(0);
		const output = result.stdout;
		expect(output).toContain("init");
		expect(output).toContain("mod");
		expect(output).toContain("build");
		expect(output).toContain("deploy");
		expect(output).toContain("logout");
		expect(output).toContain("update");
	});

	test("dot update reports a meaningful outcome", async () => {
		const result = await dot(["update"]);
		expect(result.exitCode).toBe(0);
		// Without this, a regression where `dot update` silently no-ops is
		// invisible. Match either exact wording from src/commands/update.ts:
		//   "already on latest (vX.Y.Z)"  — when current === latest tag
		//   "Updated dot to vX.Y.Z"        — when an update happened
		// Both branches print "Checking for updates..." first, so anchor on
		// the outcome line.
		expect(result.stdout).toMatch(/already on latest \(v|Updated dot to v/);
		// Verify the binary still works after the update reported success.
		const version = await dot(["--version"]);
		expect(version.exitCode).toBe(0);
		expect(version.stdout).toMatch(/\d+\.\d+\.\d+/);
	});
});
