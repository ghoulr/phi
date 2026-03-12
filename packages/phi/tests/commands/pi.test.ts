import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	runPiCommand,
	shouldRunPiCommandDirectly,
	type RunPiCommandDependencies,
} from "@phi/commands/pi";

interface DependencyHarness {
	dependencies: RunPiCommandDependencies;
	runCalls: string[][];
	writes: string[];
}

function createDependencyHarness(
	params: { exitCode?: number } = {}
): DependencyHarness {
	const runCalls: string[][] = [];
	const writes: string[] = [];
	return {
		runCalls,
		writes,
		dependencies: {
			async run(args) {
				runCalls.push(args);
				return params.exitCode ?? 0;
			},
			write(text) {
				writes.push(text);
			},
		},
	};
}

describe("shouldRunPiCommandDirectly", () => {
	it("matches only the exact top-level pi command before cac help handling", () => {
		expect(shouldRunPiCommandDirectly(["pi", "--help"])).toBe(true);
		expect(shouldRunPiCommandDirectly(["service"])).toBe(false);
		expect(shouldRunPiCommandDirectly(["pip", "install"])).toBe(false);
	});
});

describe("runPiCommand", () => {
	it("prints general help instead of invoking pi when no args are provided", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-pi-home-"));
		const harness = createDependencyHarness();

		try {
			await runPiCommand([], homeDir, harness.dependencies);

			expect(harness.runCalls).toHaveLength(0);
			expect(harness.writes).toHaveLength(1);
			expect(harness.writes[0]).toContain("Global pi package commands");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("prints subcommand help instead of invoking pi when help is requested", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-pi-home-"));
		const harness = createDependencyHarness();

		try {
			await runPiCommand(
				["install", "--help"],
				homeDir,
				harness.dependencies
			);

			expect(harness.runCalls).toHaveLength(0);
			expect(harness.writes).toEqual([
				expect.stringContaining("phi pi install"),
			]);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("invokes the bundled pi entry inside the global phi pi workspace", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-pi-home-"));
		const harness = createDependencyHarness();
		const originalCwd = process.cwd();
		const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

		try {
			await runPiCommand(
				["install", "npm:@acme/pi-package"],
				homeDir,
				harness.dependencies
			);

			const agentDir = join(homeDir, ".phi", "pi");
			expect(existsSync(agentDir)).toBe(true);
			expect(harness.writes).toHaveLength(0);
			expect(harness.runCalls).toEqual([
				["install", "npm:@acme/pi-package"],
			]);
			expect(process.cwd()).toBe(originalCwd);
			expect(process.env.PI_CODING_AGENT_DIR).toBe(originalAgentDir);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("fails fast on unsupported pi subcommands", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-pi-home-"));

		try {
			await expect(
				runPiCommand(
					["config"],
					homeDir,
					createDependencyHarness().dependencies
				)
			).rejects.toThrow("Unsupported pi subcommand: config");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("fails fast when local install flags are forwarded", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-pi-home-"));

		try {
			await expect(
				runPiCommand(
					["install", "npm:@acme/pi-package", "-l"],
					homeDir,
					createDependencyHarness().dependencies
				)
			).rejects.toThrow(
				"phi pi only supports global commands; remove -l."
			);
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});

	it("fails when bundled pi reports non-zero exit", async () => {
		const homeDir = mkdtempSync(join(tmpdir(), "phi-pi-home-"));

		try {
			await expect(
				runPiCommand(
					["list"],
					homeDir,
					createDependencyHarness({ exitCode: 1 }).dependencies
				)
			).rejects.toThrow("pi list exited with code 1");
		} finally {
			rmSync(homeDir, { recursive: true, force: true });
		}
	});
});
