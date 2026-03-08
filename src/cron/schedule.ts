import { Cron } from "croner";

import type { LoadedCronJob } from "@phi/cron/types";

interface LocalDateTimeParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

function getZonedDateTimeParts(
	timestampMs: number,
	timezone: string
): LocalDateTimeParts {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	const parts = formatter.formatToParts(new Date(timestampMs));
	const values = Object.fromEntries(
		parts
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, part.value])
	);

	return {
		year: Number(values.year),
		month: Number(values.month),
		day: Number(values.day),
		hour: Number(values.hour),
		minute: Number(values.minute),
		second: Number(values.second),
	};
}

function parseLocalDateTime(input: string): LocalDateTimeParts {
	const match =
		/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?$/.exec(
			input
		);
	if (!match?.groups) {
		throw new Error(`Invalid local datetime: ${input}`);
	}

	const parts: LocalDateTimeParts = {
		year: Number(match.groups.year),
		month: Number(match.groups.month),
		day: Number(match.groups.day),
		hour: Number(match.groups.hour),
		minute: Number(match.groups.minute),
		second: match.groups.second ? Number(match.groups.second) : 0,
	};

	if (
		parts.month < 1 ||
		parts.month > 12 ||
		parts.day < 1 ||
		parts.day > 31 ||
		parts.hour > 23 ||
		parts.minute > 59 ||
		parts.second > 59
	) {
		throw new Error(`Invalid local datetime: ${input}`);
	}

	return parts;
}

function partsToComparableValue(parts: LocalDateTimeParts): number {
	return Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second
	);
}

export function parseAtDateTimeToMs(at: string, timezone: string): number {
	const target = parseLocalDateTime(at);
	let guessMs = Date.UTC(
		target.year,
		target.month - 1,
		target.day,
		target.hour,
		target.minute,
		target.second
	);

	for (let attempt = 0; attempt < 4; attempt += 1) {
		const zoned = getZonedDateTimeParts(guessMs, timezone);
		const diffMs =
			partsToComparableValue(target) - partsToComparableValue(zoned);
		if (diffMs === 0) {
			return guessMs;
		}
		guessMs += diffMs;
	}

	const resolved = getZonedDateTimeParts(guessMs, timezone);
	if (partsToComparableValue(resolved) !== partsToComparableValue(target)) {
		throw new Error(
			`Invalid local datetime for timezone ${timezone}: ${at}`
		);
	}

	return guessMs;
}

export function computeCronJobNextRunAtMs(
	job: LoadedCronJob,
	timezone: string,
	nowMs: number
): number | undefined {
	if (!job.enabled) {
		return undefined;
	}

	if (job.at) {
		const atMs = parseAtDateTimeToMs(job.at, timezone);
		return atMs > nowMs ? atMs : undefined;
	}

	if (!job.cron) {
		throw new Error(`Cron job ${job.id} is missing cron expression`);
	}

	const cron = new Cron(job.cron, {
		timezone,
		catch: false,
	});
	const next = cron.nextRun(new Date(nowMs));
	if (!next) {
		return undefined;
	}

	const nextMs = next.getTime();
	if (!Number.isFinite(nextMs)) {
		return undefined;
	}
	if (nextMs > nowMs) {
		return nextMs;
	}

	const retry = cron.nextRun(
		new Date(Math.floor(nowMs / 1000) * 1000 + 1000)
	);
	if (!retry) {
		return undefined;
	}
	return retry.getTime();
}
