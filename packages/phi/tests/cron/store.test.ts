import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import { ensureChatWorkspaceLayout } from "@phi/core/chat-workspace";
import { loadPhiCronConfig } from "@phi/cron/config";
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
				layout.cronConfigFilePath,
				[
					"jobs:",
					"  - id: daily",
					"    sessionId: alice-main",
					"    endpointChatId: 42",
					"    prompt: jobs/daily.md",
					'    cron: "0 9 * * *"',
				].join("\n"),
				"utf-8"
			);
			const cronConfig = loadPhiCronConfig(layout.cronConfigFilePath);

			expect(loadCronJobs({ layout, cronConfig })).toEqual([
				{
					id: "daily",
					enabled: true,
					sessionId: "alice-main",
					endpointChatId: "42",
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
				layout.cronConfigFilePath,
				[
					"jobs:",
					"  - id: daily",
					"    sessionId: alice-main",
					"    endpointChatId: 42",
					"    prompt: jobs/daily.md",
					'    cron: "0 9 * * *"',
					'    at: "2026-03-08 09:00"',
				].join("\n"),
				"utf-8"
			);
			const cronConfig = loadPhiCronConfig(layout.cronConfigFilePath);

			expect(() => loadCronJobs({ layout, cronConfig })).toThrow(
				"exactly one of cron or at must be set"
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails when endpointChatId is missing", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-cron-store-"));

		try {
			const layout = ensureChatWorkspaceLayout(root);
			writeFileSync(
				join(layout.cronJobsDir, "daily.md"),
				"# Daily\nDo work.\n",
				"utf-8"
			);
			writeFileSync(
				layout.cronConfigFilePath,
				[
					"jobs:",
					"  - id: daily",
					"    sessionId: alice-main",
					"    prompt: jobs/daily.md",
					'    cron: "0 9 * * *"',
				].join("\n"),
				"utf-8"
			);
			const cronConfig = loadPhiCronConfig(layout.cronConfigFilePath);

			expect(() => loadCronJobs({ layout, cronConfig })).toThrow(
				"Invalid cron job daily: missing endpointChatId"
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
