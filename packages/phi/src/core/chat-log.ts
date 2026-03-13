import { appendStructuredLogEntry } from "@phi/core/logger";

export type ChatLogDirection = "inbound" | "outbound";

export type ChatLogSource = "user" | "assistant" | "error";

export interface ChatLogEntry {
	idempotencyKey: string;
	endpoint: "telegram";
	chatId: string;
	telegramChatId: string;
	telegramUpdateId?: string;
	telegramMessageId?: string;
	direction: ChatLogDirection;
	source: ChatLogSource;
	text: string;
}

export function appendChatLogEntry(entry: ChatLogEntry): void {
	appendStructuredLogEntry({
		tag: entry.endpoint,
		event: "telegram.message",
		category: "audit",
		message: `telegram ${entry.direction} message`,
		...entry,
	});
}
