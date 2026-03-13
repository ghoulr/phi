import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "bun:test";

import {
	__test__,
	appendStructuredLogEntry,
	getPhiLogger,
	resetPhiLoggerForTest,
	setPhiLoggerSettingsForTest,
} from "@phi/core/logger";

function createLogCapture(): {
	stream: Writable;
	readLines(): string[];
} {
	let output = "";
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			output += chunk.toString();
			callback();
		},
	});
	return {
		stream,
		readLines(): string[] {
			return output.split("\n").filter((line) => line.length > 0);
		},
	};
}

const originalNodeEnv = process.env.NODE_ENV;
const originalLogLevel = process.env.PHI_LOG_LEVEL;
const originalLogFormat = process.env.PHI_LOG_FORMAT;

afterEach(() => {
	process.env.NODE_ENV = originalNodeEnv;
	if (originalLogLevel === undefined) {
		delete process.env.PHI_LOG_LEVEL;
	} else {
		process.env.PHI_LOG_LEVEL = originalLogLevel;
	}
	if (originalLogFormat === undefined) {
		delete process.env.PHI_LOG_FORMAT;
	} else {
		process.env.PHI_LOG_FORMAT = originalLogFormat;
	}
	resetPhiLoggerForTest();
});

describe("phi logger", () => {
	it("writes structured runtime logs with tag and event", () => {
		const capture = createLogCapture();
		setPhiLoggerSettingsForTest({
			level: "debug",
			format: "json",
			stream: capture.stream,
		});
		const log = getPhiLogger("service").child({ chatId: "alice" });

		log.info("service.started", {
			message: "service started",
			runningServiceCount: 2,
		});

		const [line] = capture.readLines();
		const record = JSON.parse(line ?? "{}") as Record<string, unknown>;
		expect(record.tag).toBe("service");
		expect(record.event).toBe("service.started");
		expect(record.chatId).toBe("alice");
		expect(record.message).toBe("service started");
		expect(record.runningServiceCount).toBe(2);
	});

	it("writes structured audit entries to stdio", () => {
		const capture = createLogCapture();
		setPhiLoggerSettingsForTest({
			level: "info",
			format: "json",
			stream: capture.stream,
		});

		appendStructuredLogEntry({
			tag: "telegram",
			event: "telegram.message",
			category: "audit",
			idempotencyKey: "k1",
			direction: "outbound",
			source: "assistant",
			chatId: "alice",
			endpoint: "telegram",
			telegramChatId: "42",
			telegramUpdateId: "100",
			telegramMessageId: "10",
			text: "reply",
		});

		const [line] = capture.readLines();
		const record = JSON.parse(line ?? "{}") as Record<string, unknown>;
		expect(record.category).toBe("audit");
		expect(record.event).toBe("telegram.message");
		expect(record.tag).toBe("telegram");
	});

	it("defaults to json logs in production", () => {
		process.env.NODE_ENV = "production";
		process.env.PHI_LOG_LEVEL = "info";
		const settings = __test__.resolvePhiLoggerSettings();
		expect(settings.level).toBe("info");
		expect(settings.format).toBe("json");
	});

	it("defaults to pretty logs in development", () => {
		process.env.NODE_ENV = "development";
		process.env.PHI_LOG_LEVEL = "debug";
		const settings = __test__.resolvePhiLoggerSettings();
		expect(settings.level).toBe("debug");
		expect(settings.format).toBe("pretty");
	});
});
