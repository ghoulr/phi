import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	loadPhiWorkspaceConfig,
	resolveWorkspaceSkillEnvOverrides,
	resolveWorkspaceTimezone,
} from "@phi/core/workspace-config";

describe("workspace config", () => {
	it("loads timezone and skill env overrides from workspace config", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-workspace-config-"));
		const configFilePath = join(root, "config.yaml");

		try {
			writeFileSync(
				configFilePath,
				[
					"version: 1",
					"chat:",
					"  timezone: Asia/Shanghai",
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
				resolveWorkspaceSkillEnvOverrides(config, configFilePath)
			).toEqual({
				"example-skill": {
					EXAMPLE_API_KEY: "test-key",
				},
			});
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
