import { appendFileSync, existsSync, readFileSync } from "node:fs";

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
	timestamp: string;
}

function toJsonLine(entry: ChatLogEntry): string {
	return `${JSON.stringify(entry)}\n`;
}

function parseJsonLine(line: string): ChatLogEntry {
	return JSON.parse(line) as ChatLogEntry;
}

export function appendChatLogEntry(
	logFilePath: string,
	entry: Omit<ChatLogEntry, "timestamp">
): void {
	appendFileSync(
		logFilePath,
		toJsonLine({ ...entry, timestamp: new Date().toISOString() }),
		"utf-8"
	);
}

export function hasOutboundChatLogEntry(
	logFilePath: string,
	idempotencyKey: string
): boolean {
	if (!existsSync(logFilePath)) {
		return false;
	}

	const lines = readFileSync(logFilePath, "utf-8")
		.split("\n")
		.filter((line) => line.length > 0);

	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (line === undefined) {
			continue;
		}
		const entry = parseJsonLine(line);
		if (
			entry.idempotencyKey === idempotencyKey &&
			entry.direction === "outbound"
		) {
			return true;
		}
	}

	return false;
}
