import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	appendChatLogEntry,
	hasOutboundChatLogEntry,
} from "@phi/core/chat-log";

describe("chat log", () => {
	it("returns false when log file does not exist", () => {
		expect(
			hasOutboundChatLogEntry(
				"/tmp/phi-log-file-does-not-exist.jsonl",
				"k"
			)
		).toBe(false);
	});

	it("detects whether outbound entry exists by idempotency key", () => {
		const root = mkdtempSync(join(tmpdir(), "phi-chat-log-"));
		const logFilePath = join(root, "logs.jsonl");

		try {
			appendChatLogEntry(logFilePath, {
				idempotencyKey: "k1",
				channel: "telegram",
				chatId: "user-alice",
				telegramChatId: "42",
				telegramUpdateId: "100",
				telegramMessageId: "10",
				direction: "inbound",
				source: "user",
				text: "hello",
			});
			appendChatLogEntry(logFilePath, {
				idempotencyKey: "k2",
				channel: "telegram",
				chatId: "user-bob",
				telegramChatId: "43",
				telegramUpdateId: "101",
				telegramMessageId: "11",
				direction: "inbound",
				source: "user",
				text: "hey",
			});
			appendChatLogEntry(logFilePath, {
				idempotencyKey: "k1",
				channel: "telegram",
				chatId: "user-alice",
				telegramChatId: "42",
				telegramUpdateId: "100",
				telegramMessageId: "10",
				direction: "outbound",
				source: "assistant",
				text: "reply",
			});

			expect(hasOutboundChatLogEntry(logFilePath, "k1")).toBe(true);
			expect(hasOutboundChatLogEntry(logFilePath, "k2")).toBe(false);

			const allLines = readFileSync(logFilePath, "utf-8")
				.split("\n")
				.filter((line) => line.length > 0);
			expect(allLines).toHaveLength(3);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
