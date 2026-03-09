import { afterEach, describe, expect, it } from "bun:test";

import {
	appendChatLogEntry,
	hasOutboundChatLogEntry,
	resetChatLogStateForTest,
} from "@phi/core/chat-log";
import { resetPhiLoggerForTest } from "@phi/core/logger";

afterEach(() => {
	resetChatLogStateForTest();
	resetPhiLoggerForTest();
});

describe("chat log", () => {
	it("returns false when outbound idempotency key was never recorded", () => {
		expect(hasOutboundChatLogEntry("k")).toBe(false);
	});

	it("detects whether outbound entry exists by idempotency key", () => {
		appendChatLogEntry({
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
		appendChatLogEntry({
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
		appendChatLogEntry({
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

		expect(hasOutboundChatLogEntry("k1")).toBe(true);
		expect(hasOutboundChatLogEntry("k2")).toBe(false);
	});
});
