import type { LoadedCronJob } from "@phi/cron/types";

interface LocalDateTimeParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

const MAX_CRON_PARSE_ATTEMPTS = 24 * 60;

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

function getUtcDateTimeParts(timestampMs: number): LocalDateTimeParts {
	const date = new Date(timestampMs);
	return {
		year: date.getUTCFullYear(),
		month: date.getUTCMonth() + 1,
		day: date.getUTCDate(),
		hour: date.getUTCHours(),
		minute: date.getUTCMinutes(),
		second: date.getUTCSeconds(),
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

function formatLocalDateTime(parts: LocalDateTimeParts): string {
	return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
}

function isInvalidLocalDateTimeForTimezoneError(
	error: unknown,
	timezone: string
): boolean {
	return (
		error instanceof Error &&
		error.message.startsWith(
			`Invalid local datetime for timezone ${timezone}:`
		)
	);
}

function toComparableLocalTimestampMs(
	timestampMs: number,
	timezone: string
): number {
	return partsToComparableValue(getZonedDateTimeParts(timestampMs, timezone));
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

	let relativeMs = toComparableLocalTimestampMs(nowMs, timezone);
	for (let attempt = 0; attempt < MAX_CRON_PARSE_ATTEMPTS; attempt += 1) {
		const next = Bun.cron.parse(job.cron, relativeMs);
		if (!next) {
			return undefined;
		}

		const candidateAt = formatLocalDateTime(
			getUtcDateTimeParts(next.getTime())
		);
		try {
			const candidateMs = parseAtDateTimeToMs(candidateAt, timezone);
			if (candidateMs > nowMs) {
				return candidateMs;
			}
		} catch (error: unknown) {
			if (!isInvalidLocalDateTimeForTimezoneError(error, timezone)) {
				throw error;
			}
		}

		relativeMs = next.getTime() + 1000;
	}

	throw new Error(
		`Unable to resolve cron expression for job ${job.id} in timezone ${timezone}`
	);
}
