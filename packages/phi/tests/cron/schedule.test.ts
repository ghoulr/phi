import { describe, expect, it } from "bun:test";

import {
	computeCronJobNextRunAtMs,
	parseAtDateTimeToMs,
} from "@phi/cron/schedule";
import type { LoadedCronJob } from "@phi/cron/types";

const TIMEZONE = "Asia/Shanghai";

function createCronJob(overrides: Partial<LoadedCronJob> = {}): LoadedCronJob {
	return {
		id: "daily",
		enabled: true,
		sessionId: "alice-main",
		endpointChatId: "42",
		prompt: "jobs/daily.md",
		promptFilePath: "/tmp/daily.md",
		promptText: "Do work",
		cron: "0 9 * * *",
		...overrides,
	};
}

describe("cron schedule", () => {
	it("parses chat-local at time into the exact UTC timestamp", () => {
		expect(parseAtDateTimeToMs("2026-03-08 09:00", TIMEZONE)).toBe(
			Date.UTC(2026, 2, 8, 1, 0, 0)
		);
	});

	it("computes the exact next recurring run in the chat timezone", () => {
		expect(
			computeCronJobNextRunAtMs(
				createCronJob(),
				TIMEZONE,
				Date.UTC(2026, 2, 7, 0, 0, 0)
			)
		).toBe(Date.UTC(2026, 2, 7, 1, 0, 0));
	});

	it("moves to the next recurrence when now is already on the scheduled boundary", () => {
		expect(
			computeCronJobNextRunAtMs(
				createCronJob(),
				TIMEZONE,
				Date.UTC(2026, 2, 7, 1, 0, 0)
			)
		).toBe(Date.UTC(2026, 2, 8, 1, 0, 0));
	});

	it("computes DST-aware recurring runs", () => {
		expect(
			computeCronJobNextRunAtMs(
				createCronJob({ cron: "30 2 * * *" }),
				"America/New_York",
				Date.UTC(2026, 2, 8, 6, 0, 0)
			)
		).toBe(Date.UTC(2026, 2, 9, 6, 30, 0));
	});

	it("returns undefined when one-shot job is already in the past", () => {
		expect(
			computeCronJobNextRunAtMs(
				createCronJob({
					cron: undefined,
					at: "2026-03-07 08:00",
				}),
				TIMEZONE,
				Date.UTC(2026, 2, 7, 1, 0, 1)
			)
		).toBeUndefined();
	});
});
