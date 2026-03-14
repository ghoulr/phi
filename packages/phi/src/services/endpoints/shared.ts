import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import {
	getChatInboxDirectoryPath,
	resolveChatWorkspaceDirectory,
} from "@phi/core/chat-workspace";
import {
	chunkTextForOutbound,
	sanitizeOutboundText,
} from "@phi/core/message-text";
import type { PhiMessage, PhiMessageAttachment } from "@phi/messaging/types";

import type { EndpointAttachment } from "./types.js";

export interface SaveAttachmentParams {
	data: Uint8Array;
	fileName?: string;
	filePath: string;
	contentType?: string;
	workspace: string;
	datePrefix?: string;
	prefix?: string;
}

export interface SavedAttachment extends EndpointAttachment {
	path: string;
}

export class DedupSet {
	private readonly set = new Set<string>();

	constructor(private readonly maxSize = 10000) {}

	has(key: string): boolean {
		return this.set.has(key);
	}

	add(key: string): void {
		if (this.set.size >= this.maxSize) {
			const first = this.set.values().next().value;
			if (first) {
				this.set.delete(first);
			}
		}
		this.set.add(key);
	}

	delete(key: string): void {
		this.set.delete(key);
	}
}

export function createHashedInstanceId(
	prefix: string,
	value: string,
	suffixLength = 7
): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return `${prefix}-${(hash >>> 0).toString(36).slice(0, suffixLength)}`;
}

export function buildInboxDatePrefix(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

export function sanitizeFileName(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function resolveAttachmentExtension(params: {
	fileName?: string;
	filePath: string;
	contentType?: string;
}): string {
	const fromFileName = extname(params.fileName ?? "");
	if (fromFileName) return fromFileName;

	const fromPath = extname(params.filePath);
	if (fromPath) return fromPath;

	switch (params.contentType) {
		case "image/jpeg":
			return ".jpg";
		case "image/png":
			return ".png";
		case "image/webp":
			return ".webp";
		case "application/pdf":
			return ".pdf";
		default:
			return "";
	}
}

export function saveInboundAttachment(
	params: SaveAttachmentParams
): SavedAttachment {
	const datePrefix = params.datePrefix ?? buildInboxDatePrefix();
	const workspaceDir = resolveChatWorkspaceDirectory(params.workspace);
	const inboxDir = join(getChatInboxDirectoryPath(workspaceDir), datePrefix);
	mkdirSync(inboxDir, { recursive: true });

	const extension = resolveAttachmentExtension({
		fileName: params.fileName,
		filePath: params.filePath,
		contentType: params.contentType,
	});
	const originalName =
		params.fileName ??
		basename(params.filePath, extname(params.filePath)) ??
		"attachment";
	const cleanName = sanitizeFileName(
		`${originalName.replace(/\.[^.]+$/, "")}${extension}`
	);
	const prefix = params.prefix ?? "";
	const absolutePath = join(inboxDir, `${prefix}${cleanName}`);
	writeFileSync(absolutePath, params.data);

	return {
		path: absolutePath,
		name: cleanName,
		mimeType: params.contentType,
	};
}

export async function chunkAndSend(
	text: string,
	limit: number,
	send: (text: string) => Promise<void>
): Promise<void> {
	const sanitized = sanitizeOutboundText(text);
	const chunks = chunkTextForOutbound(sanitized, limit);
	if (chunks.length === 0) {
		throw new Error("Outbound message is empty after sanitization.");
	}
	for (const chunk of chunks) {
		await send(chunk);
	}
}

export function createIdempotencyKey(
	endpoint: string,
	...parts: (string | number)[]
): string {
	return `${endpoint}:${parts.map(String).join(":")}`;
}

export function resolveOutboundAuditText(message: PhiMessage): string {
	return message.text ?? `[${message.attachments.length} attachment(s)]`;
}

export async function isImageAttachment(
	attachment: PhiMessageAttachment
): Promise<boolean> {
	const contentType = Bun.file(attachment.path).type;
	return contentType.startsWith("image/");
}
