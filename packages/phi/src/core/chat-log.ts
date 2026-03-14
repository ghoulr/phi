import { appendStructuredLogEntry } from "@phi/core/logger";

export type ChatLogDirection = "inbound" | "outbound";

export type ChatLogSource = "user" | "assistant" | "error";

export interface ChatLogEntry {
	idempotencyKey: string;
	endpoint: "telegram" | "feishu";
	chatId: string;
	telegramChatId?: string;
	telegramUpdateId?: string;
	telegramMessageId?: string;
	feishuChatId?: string;
	feishuEventId?: string;
	feishuMessageId?: string;
	direction: ChatLogDirection;
	source: ChatLogSource;
	text: string;
}

export function appendChatLogEntry(entry: ChatLogEntry): void {
	appendStructuredLogEntry({
		tag: entry.endpoint,
		event: `${entry.endpoint}.message`,
		category: "audit",
		message: `${entry.endpoint} ${entry.direction} message`,
		...entry,
	});
}
