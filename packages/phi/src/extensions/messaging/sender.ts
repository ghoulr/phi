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

function extractIndentedBlock(
	text: string,
	marker: string,
	indent: string
): string | undefined {
	const startIndex = text.indexOf(marker);
	if (startIndex === -1) {
		return undefined;
	}
	const lines = text.slice(startIndex + marker.length).split("\n");
	const blockLines: string[] = [];
	for (const line of lines) {
		if (!line.startsWith(indent)) {
			break;
		}
		blockLines.push(line);
	}
	if (blockLines.length === 0) {
		return undefined;
	}
	return blockLines.join("\n");
}

function matchValue(block: string, pattern: string): string | undefined {
	const match = block.match(new RegExp(pattern, "m"));
	return match?.[1]?.trim();
}

function resolveCurrentTurnReminderBlock(
	ctx: ExtensionContext,
	marker: string,
	indent: string
): string | undefined {
	const userText = extractLatestUserText(ctx);
	if (!userText) {
		return undefined;
	}
	const reminderText = extractReminderText(userText);
	if (!reminderText) {
		return undefined;
	}
	return extractIndentedBlock(reminderText, marker, indent);
}

export function resolveSenderMentionFromCurrentTurn(
	ctx: ExtensionContext
): PhiMessageMention | undefined {
	const currentMessageBlock = resolveCurrentTurnReminderBlock(
		ctx,
		"current_message:\n",
		"  "
	);
	if (!currentMessageBlock) {
		return undefined;
	}
	const senderBlock = extractIndentedBlock(
		currentMessageBlock,
		"  from:\n",
		"    "
	);
	if (!senderBlock) {
		return undefined;
	}
	const userId = matchValue(senderBlock, "^    id: (.+)$");
	if (!userId) {
		return undefined;
	}
	const firstName = matchValue(senderBlock, "^    first_name: (.+)$");
	const lastName = matchValue(senderBlock, "^    last_name: (.+)$");
	const displayName = [firstName, lastName]
		.filter((part): part is string => Boolean(part))
		.join(" ");
	return {
		userId,
		username: matchValue(senderBlock, "^    username: (.+)$"),
		displayName: displayName || undefined,
	};
}
