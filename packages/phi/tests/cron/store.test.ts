import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { ensureChatWorkspaceLayout } from "@phi/core/chat-workspace";
import { loadPhiWorkspaceConfig } from "@phi/core/workspace-config";
import { loadCronJobs } from "@phi/cron/store";

describe("loadCronJobs", () => {
	it("loads cron jobs and prompt files", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-cron-store-"));

		try {
			const layout = ensureChatWorkspaceLayout(root);
			writeFileSync(
				join(layout.cronJobsDir, "daily.md"),
				"# Daily\nDo work.\n",
				"utf-8"
			);
			writeFileSync(
				layout.configFilePath,
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
			const workspaceConfig = loadPhiWorkspaceConfig(
				layout.configFilePath
			);

			expect(loadCronJobs({ layout, workspaceConfig })).toEqual([
				{
					id: "daily",
					enabled: true,
					prompt: "jobs/daily.md",
					promptFilePath: join(layout.cronJobsDir, "daily.md"),
					promptText: "# Daily\nDo work.",
					cron: "0 9 * * *",
					at: undefined,
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails when both cron and at are set", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-cron-store-"));

		try {
			const layout = ensureChatWorkspaceLayout(root);
			writeFileSync(
				join(layout.cronJobsDir, "daily.md"),
				"# Daily\nDo work.\n",
				"utf-8"
			);
			writeFileSync(
				layout.configFilePath,
				[
					"version: 1",
					"cron:",
					"  enabled: true",
					"  jobs:",
					"    - id: daily",
					"      prompt: jobs/daily.md",
					'      cron: "0 9 * * *"',
					'      at: "2026-03-08 09:00"',
				].join("\n"),
				"utf-8"
			);
			const workspaceConfig = loadPhiWorkspaceConfig(
				layout.configFilePath
			);

			expect(() => loadCronJobs({ layout, workspaceConfig })).toThrow(
				"exactly one of cron or at must be set"
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails when prompt path escapes cron directory", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-cron-store-"));

		try {
			const layout = ensureChatWorkspaceLayout(root);
			writeFileSync(
				layout.configFilePath,
				[
					"version: 1",
					"cron:",
					"  enabled: true",
					"  jobs:",
					"    - id: daily",
					"      prompt: ../outside.md",
					'      cron: "0 9 * * *"',
				].join("\n"),
				"utf-8"
			);
			const workspaceConfig = loadPhiWorkspaceConfig(
				layout.configFilePath
			);

			expect(() => loadCronJobs({ layout, workspaceConfig })).toThrow(
				"Invalid prompt path for cron job daily"
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
