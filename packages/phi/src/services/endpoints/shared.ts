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
import type { PhiMessageAttachment } from "@phi/messaging/types";

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

export async function isImageAttachment(
	attachment: PhiMessageAttachment
): Promise<boolean> {
	const contentType = Bun.file(attachment.path).type;
	return contentType.startsWith("image/");
}
