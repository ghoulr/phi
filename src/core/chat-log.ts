import { appendStructuredLogEntry } from "@phi/core/logger";

export type ChatLogDirection = "inbound" | "outbound";

export type ChatLogSource = "user" | "assistant" | "error";

export interface ChatLogEntry {
	idempotencyKey: string;
	channel: "telegram";
	chatId: string;
	telegramChatId: string;
	telegramUpdateId: string;
	telegramMessageId: string;
	direction: ChatLogDirection;
	source: ChatLogSource;
	text: string;
}

const deliveredOutboundIdempotencyKeys = new Set<string>();

export function appendChatLogEntry(entry: ChatLogEntry): void {
	if (entry.direction === "outbound") {
		deliveredOutboundIdempotencyKeys.add(entry.idempotencyKey);
	}
	appendStructuredLogEntry({
		tag: entry.channel,
		event: "telegram.message",
		category: "audit",
		message: `telegram ${entry.direction} message`,
		...entry,
	});
}

export function hasOutboundChatLogEntry(idempotencyKey: string): boolean {
	return deliveredOutboundIdempotencyKeys.has(idempotencyKey);
}

export function resetChatLogStateForTest(): void {
	deliveredOutboundIdempotencyKeys.clear();
}
