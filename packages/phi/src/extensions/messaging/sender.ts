import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { PhiMessageMention } from "@phi/messaging/types";

function extractLatestUserText(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (
			!entry ||
			entry.type !== "message" ||
			entry.message.role !== "user"
		) {
			continue;
		}
		if (typeof entry.message.content === "string") {
			return entry.message.content;
		}
		if (!Array.isArray(entry.message.content)) {
			continue;
		}
		return entry.message.content
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("\n");
	}
	return undefined;
}

function extractReminderText(text: string): string | undefined {
	const startIndex = text.lastIndexOf("<system-reminder>");
	if (startIndex === -1) {
		return undefined;
	}
	const endIndex = text.indexOf("</system-reminder>", startIndex);
	if (endIndex === -1) {
		return undefined;
	}
	const reminderText = text
		.slice(startIndex + "<system-reminder>".length, endIndex)
		.trim();
	return reminderText || undefined;
}

function extractCurrentMessageFromBlock(
	reminderText: string
): string | undefined {
	const marker = "current_message:\n";
	const startIndex = reminderText.indexOf(marker);
	if (startIndex === -1) {
		return undefined;
	}
	const lines = reminderText.slice(startIndex + marker.length).split("\n");
	const currentMessageLines: string[] = [];
	for (const line of lines) {
		if (!line.startsWith("  ")) {
			break;
		}
		currentMessageLines.push(line);
	}
	if (currentMessageLines.length === 0) {
		return undefined;
	}
	return currentMessageLines.join("\n");
}

function extractSenderBlock(currentMessageBlock: string): string | undefined {
	const marker = "  from:\n";
	const startIndex = currentMessageBlock.indexOf(marker);
	if (startIndex === -1) {
		return undefined;
	}
	const lines = currentMessageBlock
		.slice(startIndex + marker.length)
		.split("\n");
	const senderLines: string[] = [];
	for (const line of lines) {
		if (!line.startsWith("    ")) {
			break;
		}
		senderLines.push(line);
	}
	if (senderLines.length === 0) {
		return undefined;
	}
	return senderLines.join("\n");
}

function matchSenderValue(
	senderBlock: string,
	key: "id" | "username" | "first_name" | "last_name"
): string | undefined {
	const match = senderBlock.match(new RegExp(`^    ${key}: (.+)$`, "m"));
	return match?.[1]?.trim();
}

export function resolveSenderMentionFromCurrentTurn(
	ctx: ExtensionContext
): PhiMessageMention | undefined {
	const userText = extractLatestUserText(ctx);
	if (!userText) {
		return undefined;
	}
	const reminderText = extractReminderText(userText);
	if (!reminderText) {
		return undefined;
	}
	const currentMessageBlock = extractCurrentMessageFromBlock(reminderText);
	if (!currentMessageBlock) {
		return undefined;
	}
	const senderBlock = extractSenderBlock(currentMessageBlock);
	if (!senderBlock) {
		return undefined;
	}
	const userId = matchSenderValue(senderBlock, "id");
	if (!userId) {
		return undefined;
	}
	const firstName = matchSenderValue(senderBlock, "first_name");
	const lastName = matchSenderValue(senderBlock, "last_name");
	const displayName = [firstName, lastName]
		.filter((part): part is string => Boolean(part))
		.join(" ");
	return {
		userId,
		username: matchSenderValue(senderBlock, "username"),
		displayName: displayName || undefined,
	};
}
