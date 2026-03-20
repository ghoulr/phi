import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	loadPhiCronConfig,
	resolveCronJobDefinitions,
	writePhiCronConfig,
} from "@phi/cron/config";

describe("cron config", () => {
	it("loads and writes cron job definitions", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-cron-config-"));
		const configFilePath = join(root, "cron.yaml");

		try {
			writePhiCronConfig(configFilePath, {
				jobs: [
					{
						id: "daily",
						sessionId: "alice-main",
						endpointChatId: "42",
						prompt: "jobs/daily.md",
						cron: "0 9 * * *",
					},
				],
			});

			const config = loadPhiCronConfig(configFilePath);
			expect(resolveCronJobDefinitions(config, configFilePath)).toEqual([
				{
					id: "daily",
					sessionId: "alice-main",
					endpointChatId: "42",
					prompt: "jobs/daily.md",
					cron: "0 9 * * *",
				},
			]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("fails when jobs is not a list", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-cron-config-"));
		const configFilePath = join(root, "cron.yaml");

		try {
			writeFileSync(configFilePath, "jobs: daily\n", "utf-8");
			expect(() => loadPhiCronConfig(configFilePath)).toThrow(
				"Invalid cron config: jobs must be a list"
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
