import type { AgentMessage } from "@mariozechner/pi-agent-core";

import type { PhiMessage } from "@phi/messaging/types";

function extractAssistantText(message: AgentMessage): string | undefined {
	if (message.role !== "assistant") {
		return undefined;
	}
	if (!Array.isArray(message.content)) {
		return undefined;
	}
	const text = message.content
		.map((part) => {
			if (
				typeof part !== "object" ||
				part === null ||
				!("type" in part) ||
				part.type !== "text" ||
				!("text" in part) ||
				typeof part.text !== "string"
			) {
				return "";
			}
			return part.text;
		})
		.join("")
		.trim();
	return text || undefined;
}

export function extractLastAssistantText(
	messages: AgentMessage[]
): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message) {
			continue;
		}
		const text = extractAssistantText(message);
		if (text) {
			return text;
		}
	}
	return undefined;
}

export function resolvePlainAssistantMessage(
	assistantText: string | undefined
): PhiMessage[] {
	const text = assistantText?.trim();
	if (!text) {
		return [];
	}
	return [{ text, attachments: [] }];
}
