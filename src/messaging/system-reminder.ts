import type { ImageContent, TextContent } from "@mariozechner/pi-ai";

const TEXT_BLOCK_KEYS = new Set(["text", "caption", "body"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function cleanReminderMetadata(value: unknown): unknown {
	if (value === null || value === undefined) {
		return undefined;
	}

	if (Array.isArray(value)) {
		const cleaned = value
			.map((item) => cleanReminderMetadata(item))
			.filter((item) => item !== undefined);
		return cleaned.length > 0 ? cleaned : undefined;
	}

	if (!isRecord(value)) {
		return value;
	}

	const cleanedEntries = Object.entries(value)
		.map(([key, nestedValue]) => {
			return [key, cleanReminderMetadata(nestedValue)] as const;
		})
		.filter(([, nestedValue]) => nestedValue !== undefined);
	if (cleanedEntries.length === 0) {
		return undefined;
	}
	return Object.fromEntries(cleanedEntries);
}

function appendScalar(
	lines: string[],
	indent: string,
	key: string,
	value: string | number | boolean
): void {
	if (typeof value === "string" && TEXT_BLOCK_KEYS.has(key)) {
		lines.push(
			`${indent}${key}:`,
			`${indent}\`\`\`text`,
			value,
			`${indent}\`\`\``
		);
		return;
	}
	lines.push(`${indent}${key}: ${String(value)}`);
}

function appendValue(
	lines: string[],
	indent: string,
	key: string,
	value: unknown
): void {
	if (value === null || value === undefined) {
		return;
	}

	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		appendScalar(lines, indent, key, value);
		return;
	}

	if (Array.isArray(value)) {
		lines.push(`${indent}${key}:`);
		for (const item of value) {
			appendArrayItem(lines, `${indent}  `, item);
		}
		return;
	}

	if (isRecord(value)) {
		lines.push(`${indent}${key}:`);
		appendObject(lines, `${indent}  `, value);
	}
}

function appendArrayItem(
	lines: string[],
	indent: string,
	value: unknown
): void {
	if (value === null || value === undefined) {
		return;
	}

	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		lines.push(`${indent}- ${String(value)}`);
		return;
	}

	if (Array.isArray(value)) {
		lines.push(`${indent}-`);
		for (const item of value) {
			appendArrayItem(lines, `${indent}  `, item);
		}
		return;
	}

	if (isRecord(value)) {
		lines.push(`${indent}-`);
		appendObject(lines, `${indent}  `, value);
	}
}

function appendObject(
	lines: string[],
	indent: string,
	value: Record<string, unknown>
): void {
	for (const [key, nestedValue] of Object.entries(value)) {
		appendValue(lines, indent, key, nestedValue);
	}
}

export function buildPhiSystemReminder(
	metadata: Record<string, unknown> | undefined
): string | undefined {
	const cleaned = cleanReminderMetadata(metadata);
	if (!isRecord(cleaned)) {
		return undefined;
	}

	const lines = ["<system-reminder>"];
	appendObject(lines, "", cleaned);
	lines.push("</system-reminder>");
	return lines.join("\n");
}

export function appendPhiSystemReminderToUserContent(
	content: string | (TextContent | ImageContent)[],
	reminder: string | undefined
): string | (TextContent | ImageContent)[] {
	if (!reminder) {
		return content;
	}

	if (typeof content === "string") {
		return [
			{ type: "text", text: content },
			{ type: "text", text: reminder },
		];
	}

	return [...content, { type: "text", text: reminder }];
}
