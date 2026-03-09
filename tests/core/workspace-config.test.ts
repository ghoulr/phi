import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	loadPhiWorkspaceConfig,
	resolveWorkspaceCronJobDefinitions,
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
});
