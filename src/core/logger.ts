import type { Writable } from "node:stream";

import pino from "pino";
import pinoPretty from "pino-pretty";

const LOG_LEVELS = ["silent", "debug", "info", "warn", "error"] as const;
const LOG_FORMATS = ["pretty", "json"] as const;

export type PhiLogLevel = (typeof LOG_LEVELS)[number];
export type PhiLogFormat = (typeof LOG_FORMATS)[number];

type PhiRuntimeLogLevel = Exclude<PhiLogLevel, "silent">;

type PhiLoggerBindingsValue = string | number | boolean;

export type PhiLoggerBindings = Record<
	string,
	PhiLoggerBindingsValue | undefined
>;

export type PhiLoggerFields = Record<string, unknown> & {
	message?: string;
};

export interface PhiLoggerSettings {
	level?: PhiLogLevel;
	format?: PhiLogFormat;
	stream?: Writable;
}

export interface PhiLogger {
	child(bindings: PhiLoggerBindings): PhiLogger;
	debug(event: string, fields?: PhiLoggerFields): void;
	info(event: string, fields?: PhiLoggerFields): void;
	warn(event: string, fields?: PhiLoggerFields): void;
	error(event: string, fields?: PhiLoggerFields): void;
}

export interface PhiStructuredLogEntry {
	level?: PhiRuntimeLogLevel;
	tag: string;
	event: string;
	message?: string;
	category?: string;
	[key: string]: unknown;
}

interface ResolvedPhiLoggerSettings {
	level: PhiLogLevel;
	format: PhiLogFormat;
	stream?: Writable;
}

let settingsOverride: PhiLoggerSettings | null = null;
let cachedLogger: pino.Logger | null = null;
let cachedSettings: ResolvedPhiLoggerSettings | null = null;

function isTestEnvironment(): boolean {
	if (process.env.NODE_ENV === "test") {
		return true;
	}
	if (process.env.VITEST === "true") {
		return true;
	}
	if (typeof process.env.JEST_WORKER_ID === "string") {
		return true;
	}
	return process.argv.some(
		(argument) =>
			argument.endsWith(".test.ts") ||
			argument.endsWith(".test.js") ||
			argument.endsWith(".spec.ts") ||
			argument.endsWith(".spec.js")
	);
}

function isProductionEnvironment(): boolean {
	return process.env.NODE_ENV === "production";
}

function normalizeLogLevel(
	value: string | undefined,
	fallback: PhiLogLevel
): PhiLogLevel {
	if (!value) {
		return fallback;
	}
	return (LOG_LEVELS as readonly string[]).includes(value)
		? (value as PhiLogLevel)
		: fallback;
}

function normalizeLogFormat(
	value: string | undefined,
	fallback: PhiLogFormat
): PhiLogFormat {
	if (!value) {
		return fallback;
	}
	return (LOG_FORMATS as readonly string[]).includes(value)
		? (value as PhiLogFormat)
		: fallback;
}

function omitUndefined(
	record: Record<string, unknown>
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

function areSameSettings(
	left: ResolvedPhiLoggerSettings | null,
	right: ResolvedPhiLoggerSettings
): boolean {
	return (
		left?.level === right.level &&
		left.format === right.format &&
		left.stream === right.stream
	);
}

function resolveDefaultLogLevel(): PhiLogLevel {
	if (isTestEnvironment()) {
		return "silent";
	}
	if (isProductionEnvironment()) {
		return "info";
	}
	return "debug";
}

function resolveDefaultLogFormat(): PhiLogFormat {
	return isProductionEnvironment() ? "json" : "pretty";
}

function resolvePhiLoggerSettings(): ResolvedPhiLoggerSettings {
	return {
		level: normalizeLogLevel(
			settingsOverride?.level ?? process.env.PHI_LOG_LEVEL,
			resolveDefaultLogLevel()
		),
		format: normalizeLogFormat(
			settingsOverride?.format ?? process.env.PHI_LOG_FORMAT,
			resolveDefaultLogFormat()
		),
		stream: settingsOverride?.stream,
	};
}

function createPinoOptions(level: PhiLogLevel): pino.LoggerOptions {
	return {
		level,
		base: undefined,
		messageKey: "message",
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: {
			level(label: string): { level: string } {
				return { level: label };
			},
		},
	};
}

function createDestinationLogger(
	settings: ResolvedPhiLoggerSettings
): pino.Logger {
	if (settings.level === "silent") {
		return pino(createPinoOptions("silent"));
	}

	const stream =
		settings.stream ??
		(settings.format === "json"
			? process.stdout
			: pinoPretty({
					colorize: Boolean(process.stdout.isTTY),
					singleLine: true,
					translateTime: "SYS:standard",
					ignore: "pid,hostname",
				}));

	return pino(createPinoOptions(settings.level), stream);
}

function getPinoLogger(): pino.Logger {
	const settings = resolvePhiLoggerSettings();
	if (!cachedLogger || !areSameSettings(cachedSettings, settings)) {
		cachedLogger = createDestinationLogger(settings);
		cachedSettings = settings;
	}
	return cachedLogger;
}

function writeRuntimeLog(
	logger: pino.Logger,
	level: PhiRuntimeLogLevel,
	event: string,
	fields?: PhiLoggerFields
): void {
	const payload = omitUndefined({ event, ...(fields ?? {}) });
	const { message, ...data } = payload;
	const method = logger[level].bind(logger) as unknown as (
		object: Record<string, unknown>,
		message: string
	) => void;
	method(data, typeof message === "string" ? message : event);
}

function createLogMethod(
	logger: pino.Logger,
	level: PhiRuntimeLogLevel
): (event: string, fields?: PhiLoggerFields) => void {
	return (event: string, fields?: PhiLoggerFields): void => {
		writeRuntimeLog(logger, level, event, fields);
	};
}

function wrapLogger(logger: pino.Logger): PhiLogger {
	return {
		child(bindings: PhiLoggerBindings): PhiLogger {
			return wrapLogger(logger.child(omitUndefined(bindings)));
		},
		debug: createLogMethod(logger, "debug"),
		info: createLogMethod(logger, "info"),
		warn: createLogMethod(logger, "warn"),
		error: createLogMethod(logger, "error"),
	};
}

export function getPhiLogger(tag: string): PhiLogger {
	return wrapLogger(getPinoLogger().child({ tag }));
}

export function appendStructuredLogEntry(entry: PhiStructuredLogEntry): void {
	const { tag, level, event, ...fields } = entry;
	const logger = getPinoLogger().child({ tag });
	writeRuntimeLog(logger, level ?? "info", event, fields);
}

export function setPhiLoggerSettingsForTest(
	settings: PhiLoggerSettings | null
): void {
	settingsOverride = settings;
	cachedLogger = null;
	cachedSettings = null;
}

export function resetPhiLoggerForTest(): void {
	setPhiLoggerSettingsForTest(null);
}

export const __test__ = {
	resolvePhiLoggerSettings,
};
