import { describe, expect, it } from "bun:test";

import {
	computeCronJobNextRunAtMs,
	parseAtDateTimeToMs,
} from "@phi/cron/schedule";

const TIMEZONE = "Asia/Shanghai";

describe("cron schedule", () => {
	it("parses chat-local at time into a future timestamp", () => {
		const atMs = parseAtDateTimeToMs("2026-03-08 09:00", TIMEZONE);
		expect(Number.isFinite(atMs)).toBe(true);
		expect(atMs).toBeGreaterThan(Date.UTC(2026, 2, 8, 0, 0, 0));
	});

	it("computes next run for one-shot jobs", () => {
		const nextRunAtMs = computeCronJobNextRunAtMs(
			{
				id: "once",
				enabled: true,
				prompt: "jobs/once.md",
				promptFilePath: "/tmp/once.md",
				promptText: "Do work",
				at: "2026-03-08 09:00",
			},
			TIMEZONE,
			Date.UTC(2026, 2, 7, 0, 0, 0)
		);

		expect(nextRunAtMs).toBeDefined();
	});

	it("computes future run for recurring cron jobs", () => {
		const nextRunAtMs = computeCronJobNextRunAtMs(
			{
				id: "daily",
				enabled: true,
				prompt: "jobs/daily.md",
				promptFilePath: "/tmp/daily.md",
				promptText: "Do work",
				cron: "0 9 * * *",
			},
			TIMEZONE,
			Date.UTC(2026, 2, 7, 0, 0, 0)
		);

		expect(nextRunAtMs).toBeDefined();
		expect(nextRunAtMs).toBeGreaterThan(Date.UTC(2026, 2, 7, 0, 0, 0));
	});

	it("returns undefined for past one-shot jobs", () => {
		expect(
			computeCronJobNextRunAtMs(
				{
					id: "once",
					enabled: true,
					prompt: "jobs/once.md",
					promptFilePath: "/tmp/once.md",
					promptText: "Do work",
					at: "2026-03-08 09:00",
				},
				TIMEZONE,
				Date.UTC(2026, 2, 9, 0, 0, 0)
			)
		).toBeUndefined();
	});
});
