import type { AgentMessage } from "@mariozechner/pi-agent-core";

import { formatUserFacingErrorMessage } from "@phi/core/user-error";

export type AssistantVisibleOutputSource = "assistant" | "error";

export interface AssistantVisibleOutput {
	text: string;
	source: AssistantVisibleOutputSource;
}

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

function extractAssistantVisibleOutput(
	message: AgentMessage
): AssistantVisibleOutput | undefined {
	if (message.role !== "assistant") {
		return undefined;
	}

	const text = extractAssistantText(message);
	if (text) {
		return {
			text,
			source: message.stopReason === "error" ? "error" : "assistant",
		};
	}

	if (message.stopReason !== "error" || !message.errorMessage) {
		return undefined;
	}

	return {
		text: formatUserFacingErrorMessage(message.errorMessage),
		source: "error",
	};
}

export function extractLastAssistantVisibleOutput(
	messages: AgentMessage[]
): AssistantVisibleOutput | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message) {
			continue;
		}
		const output = extractAssistantVisibleOutput(message);
		if (output) {
			return output;
		}
	}
	return undefined;
}
