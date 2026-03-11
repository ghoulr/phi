import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	loadPhiWorkspaceConfig,
	resolveWorkspaceCronJobDefinitions,
	resolveWorkspaceDisabledExtensionIds,
	resolveWorkspaceSkillEnvOverrides,
	resolveWorkspaceTimezone,
} from "@phi/core/workspace-config";

describe("workspace config", () => {
	it("loads timezone and cron jobs from workspace config", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-workspace-config-"));
		const configFilePath = join(root, "config.yaml");

		try {
			writeFileSync(
				configFilePath,
				[
					"version: 1",
					"chat:",
					"  timezone: Asia/Shanghai",
					"cron:",
					"  enabled: true",
					"  jobs:",
					"    - id: daily",
					"      prompt: jobs/daily.md",
					'      cron: "0 9 * * *"',
					"skills:",
					"  entries:",
					"    example-skill:",
					"      env:",
					"        EXAMPLE_API_KEY: test-key",
				].join("\n"),
				"utf-8"
			);

			const config = loadPhiWorkspaceConfig(configFilePath);
			expect(resolveWorkspaceTimezone(config, configFilePath)).toBe(
				"Asia/Shanghai"
			);
			expect(
				resolveWorkspaceCronJobDefinitions(config, configFilePath)
			).toEqual([
				{
					id: "daily",
					prompt: "jobs/daily.md",
					cron: "0 9 * * *",
				},
			]);
			expect(
				resolveWorkspaceSkillEnvOverrides(config, configFilePath)
			).toEqual({
				"example-skill": {
					EXAMPLE_API_KEY: "test-key",
				},
			});
			expect(
				resolveWorkspaceDisabledExtensionIds(config, configFilePath)
			).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails when cron.jobs is not a list", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-workspace-config-"));
		const configFilePath = join(root, "config.yaml");

		try {
			writeFileSync(
				configFilePath,
				["version: 1", "cron:", "  jobs: daily"].join("\n"),
				"utf-8"
			);

			const config = loadPhiWorkspaceConfig(configFilePath);
			expect(() =>
				resolveWorkspaceCronJobDefinitions(config, configFilePath)
			).toThrow("Invalid workspace config: cron.jobs must be a list");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("resolves disabled extension ids", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-workspace-config-"));
		const configFilePath = join(root, "config.yaml");

		try {
			writeFileSync(
				configFilePath,
				[
					"version: 1",
					"extensions:",
					"  disabled:",
					"    - messaging",
					"    - memory-maintenance",
					"    - messaging",
				].join("\n"),
				"utf-8"
			);

			const config = loadPhiWorkspaceConfig(configFilePath);
			expect(
				resolveWorkspaceDisabledExtensionIds(config, configFilePath)
			).toEqual(["messaging", "memory-maintenance"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails when extensions.disabled contains an empty string", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-workspace-config-"));
		const configFilePath = join(root, "config.yaml");

		try {
			writeFileSync(
				configFilePath,
				["version: 1", "extensions:", "  disabled:", '    - "  "'].join(
					"\n"
				),
				"utf-8"
			);

			const config = loadPhiWorkspaceConfig(configFilePath);
			expect(() =>
				resolveWorkspaceDisabledExtensionIds(config, configFilePath)
			).toThrow(
				"Invalid workspace config: extensions.disabled must not contain empty strings"
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails when a skill env value is not a string", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-workspace-config-"));
		const configFilePath = join(root, "config.yaml");

		try {
			writeFileSync(
				configFilePath,
				[
					"version: 1",
					"skills:",
					"  entries:",
					"    bad-skill:",
					"      env:",
					"        EXAMPLE_API_KEY: 123",
				].join("\n"),
				"utf-8"
			);

			const config = loadPhiWorkspaceConfig(configFilePath);
			expect(() =>
				resolveWorkspaceSkillEnvOverrides(config, configFilePath)
			).toThrow(
				"Invalid workspace config: skills.entries.bad-skill.env.EXAMPLE_API_KEY must be a string"
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
