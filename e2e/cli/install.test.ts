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

	test("dot update succeeds and returns updated version", async () => {
		const result = await dot(["update"]);
		// update may exit 0 (updated or already up-to-date)
		expect(result.exitCode).toBe(0);
		// Verify dot --version still works after update
		const version = await dot(["--version"]);
		expect(version.exitCode).toBe(0);
		expect(version.stdout).toMatch(/\d+\.\d+\.\d+/);
	});
});
