import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type {
	AgentSession,
	AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { Bot, type BotError, type Context, InputFile } from "grammy";
import type {
	ExternalReplyInfo,
	Message,
	MessageOrigin,
} from "@grammyjs/types";

import {
	InMemoryChatExecutor,
	type ChatExecutor,
} from "@phi/core/chat-executor";
import {
	appendChatLogEntry,
	hasOutboundChatLogEntry,
} from "@phi/core/chat-log";
import {
	ensureChatWorkspaceLayout,
	getChatInboxDirectoryPath,
	resolveChatWorkspaceDirectory,
} from "@phi/core/chat-workspace";
import { getPhiLogger } from "@phi/core/logger";
import {
	chunkTextForOutbound,
	sanitizeInboundText,
	sanitizeOutboundText,
} from "@phi/core/message-text";
import type { PhiRouteDeliveryRegistry } from "@phi/messaging/route-delivery";
import {
	getPhiMessagingSessionState,
	resolvePhiSessionTurnOutput,
} from "@phi/messaging/session-state";
import {
	appendPhiSystemReminderToUserContent,
	buildPhiSystemReminder,
} from "@phi/messaging/system-reminder";
import type {
	PhiMessage,
	PhiMessageAttachment,
	PhiMessageMention,
} from "@phi/messaging/types";
import type { PhiTurnContext } from "@phi/messaging/turn-context";
import type { ChatSessionRuntime } from "@phi/core/runtime";
import {
	formatUserFacingErrorMessage,
	normalizeUnknownError,
} from "@phi/core/user-error";

const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;
const TYPING_INTERVAL_MS = 2500;

const log = getPhiLogger("telegram");

export interface TelegramInboundAttachment {
	fileId: string;
	fileName?: string;
	mimeType?: string;
	kind: "image" | "file";
}

interface DownloadedTelegramFile {
	data: Uint8Array;
	filePath: string;
	contentType?: string;
}

export interface TelegramTextMessageContext {
	updateId: number;
	chat: { id: number | string };
	message: {
		id: number | string;
		text?: string;
		attachments: TelegramInboundAttachment[];
		sender?: PhiMessageMention;
		systemReminderMetadata?: Record<string, unknown>;
	};
	reply(text: string): Promise<unknown>;
	sendTyping(): Promise<unknown>;
}

export interface TelegramPollingBot {
	onTextMessage(
		handler: (context: TelegramTextMessageContext) => Promise<void>
	): void;
	onError(handler: (error: unknown) => void): void;
	sendText(
		chatId: string,
		text: string,
		replyToMessageId?: string
	): Promise<unknown>;
	sendPhoto(
		chatId: string,
		filePath: string,
		fileName: string,
		caption?: string,
		replyToMessageId?: string
	): Promise<unknown>;
	sendDocument(
		chatId: string,
		filePath: string,
		fileName: string,
		caption?: string,
		replyToMessageId?: string
	): Promise<unknown>;
	downloadFile(fileId: string): Promise<DownloadedTelegramFile>;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface TelegramServiceDependencies {
	createBot(token: string): TelegramPollingBot;
}

export interface RunningTelegramPollingBot {
	done: Promise<void>;
	stop(): Promise<void>;
}

export interface TelegramRouteTarget {
	chatId: string;
	workspace: string;
}

export interface ResolvedTelegramPollingBotConfig {
	token: string;
	chatRoutes: Record<string, TelegramRouteTarget>;
}

function createTelegramIdempotencyKey(
	telegramChatId: string,
	updateId: number
): string {
	return `telegram:${telegramChatId}:${String(updateId)}`;
}

function normalizeTelegramChatId(value: number | string): string {
	return String(value);
}

function normalizeTelegramMessageId(value: number | string): string {
	return String(value);
}

function normalizeTelegramUpdateId(value: number): string {
	return String(value);
}

function buildTelegramInboxDatePrefix(now: Date): string {
	return now.toISOString().slice(0, 10);
}

function sanitizeTelegramInboxFileName(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function resolveTelegramAttachmentExtension(params: {
	fileName?: string;
	filePath: string;
	contentType?: string;
}): string {
	const fileNameExtension = extname(params.fileName ?? "");
	if (fileNameExtension) {
		return fileNameExtension;
	}

	const filePathExtension = extname(params.filePath);
	if (filePathExtension) {
		return filePathExtension;
	}

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

function resolveTelegramAttachmentFileName(params: {
	attachment: TelegramInboundAttachment;
	downloaded: DownloadedTelegramFile;
	index: number;
}): string {
	const extension = resolveTelegramAttachmentExtension({
		fileName: params.attachment.fileName,
		filePath: params.downloaded.filePath,
		contentType:
			params.attachment.mimeType ?? params.downloaded.contentType,
	});
	const originalName =
		params.attachment.fileName ??
		basename(
			params.downloaded.filePath,
			extname(params.downloaded.filePath)
		) ??
		`attachment-${String(params.index + 1)}`;
	return sanitizeTelegramInboxFileName(
		`${originalName.replace(/\.[^.]+$/, "")}${extension}`
	);
}

function buildTelegramInboundText(params: {
	text: string | undefined;
	attachmentPaths: string[];
	imageCount: number;
}): string {
	const lines: string[] = [];
	const normalizedText = params.text?.trim();
	if (normalizedText) {
		lines.push(normalizedText);
	}
	if (params.imageCount > 0) {
		lines.push(
			`User sent ${String(params.imageCount)} image attachment(s).`
		);
	}
	if (params.attachmentPaths.length > 0) {
		lines.push(
			"User sent attachments:",
			...params.attachmentPaths.map((path) => `- ${path}`)
		);
	}
	if (lines.length === 0) {
		throw new Error("Telegram inbound message has no supported content.");
	}
	return lines.join("\n\n");
}

function buildTelegramInboundLogText(message: {
	text?: string;
	attachments: TelegramInboundAttachment[];
}): string {
	const text = message.text?.trim();
	if (text) {
		return text;
	}
	if (message.attachments.length === 0) {
		return "";
	}
	const attachmentNames = message.attachments.map((attachment, index) => {
		return attachment.fileName ?? `${attachment.kind}-${String(index + 1)}`;
	});
	return `[attachments: ${attachmentNames.join(", ")}]`;
}

function sanitizeInboundTextOrThrow(text: string): string {
	const result = sanitizeInboundText(text);
	if (!result.ok) {
		throw new Error(result.error);
	}
	return result.message;
}

function buildTelegramReplyParams(
	replyToMessageId: string | undefined
): Record<string, unknown> {
	if (!replyToMessageId) {
		return {};
	}
	return {
		reply_parameters: {
			message_id: Number(replyToMessageId),
		},
	};
}

function buildTelegramSenderMention(
	from: Context["from"]
): PhiMessageMention | undefined {
	if (!from) {
		return undefined;
	}
	return {
		userId: String(from.id),
		username: from.username,
		displayName: [from.first_name, from.last_name]
			.filter(
				(part): part is string =>
					typeof part === "string" && part.length > 0
			)
			.join(" "),
	};
}

type TelegramReplyMessage = NonNullable<Message["reply_to_message"]>;

function buildTelegramUserMetadata(
	user: Context["from"]
): Record<string, unknown> | undefined {
	if (!user) {
		return undefined;
	}
	return {
		id: user.id,
		username: user.username,
		first_name: user.first_name,
		last_name: user.last_name,
	};
}

function buildTelegramChatMetadata(
	chat: Message["chat"] | Message["sender_chat"] | ExternalReplyInfo["chat"]
): Record<string, unknown> | undefined {
	if (!chat) {
		return undefined;
	}
	return {
		id: chat.id,
		type: chat.type,
		title: "title" in chat ? chat.title : undefined,
		username: "username" in chat ? chat.username : undefined,
	};
}

function buildTelegramOriginMetadata(
	origin: MessageOrigin | undefined
): Record<string, unknown> | undefined {
	if (!origin) {
		return undefined;
	}
	switch (origin.type) {
		case "user":
			return {
				type: origin.type,
				date: origin.date,
				sender_user: buildTelegramUserMetadata(origin.sender_user),
			};
		case "hidden_user":
			return {
				type: origin.type,
				date: origin.date,
				sender_user_name: origin.sender_user_name,
			};
		case "chat":
			return {
				type: origin.type,
				date: origin.date,
				sender_chat: buildTelegramChatMetadata(origin.sender_chat),
				author_signature: origin.author_signature,
			};
		case "channel":
			return {
				type: origin.type,
				date: origin.date,
				chat: buildTelegramChatMetadata(origin.chat),
				message_id: origin.message_id,
				author_signature: origin.author_signature,
			};
	}
}

function buildTelegramAttachmentMetadata(
	message: TelegramReplyMessage | ExternalReplyInfo | undefined
): Record<string, unknown> | undefined {
	if (!message) {
		return undefined;
	}
	return {
		photo:
			"photo" in message &&
			Array.isArray(message.photo) &&
			message.photo.length > 0
				? { count: message.photo.length }
				: undefined,
		document:
			"document" in message && message.document
				? {
						file_name: message.document.file_name,
						mime_type: message.document.mime_type,
					}
				: undefined,
		voice:
			"voice" in message && message.voice
				? {
						duration: message.voice.duration,
						mime_type: message.voice.mime_type,
					}
				: undefined,
		audio:
			"audio" in message && message.audio
				? {
						title: message.audio.title,
						file_name: message.audio.file_name,
						performer: message.audio.performer,
						duration: message.audio.duration,
					}
				: undefined,
		video:
			"video" in message && message.video
				? {
						file_name: message.video.file_name,
						mime_type: message.video.mime_type,
						duration: message.video.duration,
					}
				: undefined,
	};
}

function buildTelegramReplyToMessageMetadata(
	message: TelegramReplyMessage | undefined
): Record<string, unknown> | undefined {
	if (!message) {
		return undefined;
	}
	return {
		message_id: message.message_id,
		from: buildTelegramUserMetadata(message.from),
		sender_chat: buildTelegramChatMetadata(message.sender_chat),
		chat: buildTelegramChatMetadata(message.chat),
		text: message.text,
		caption: message.caption,
		...buildTelegramAttachmentMetadata(message),
	};
}

function buildTelegramExternalReplyMetadata(
	externalReply: ExternalReplyInfo | undefined
): Record<string, unknown> | undefined {
	if (!externalReply) {
		return undefined;
	}
	return {
		message_id: externalReply.message_id,
		origin: buildTelegramOriginMetadata(externalReply.origin),
		chat: buildTelegramChatMetadata(externalReply.chat),
		...buildTelegramAttachmentMetadata(externalReply),
	};
}

function buildTelegramQuoteMetadata(
	quote: Message["quote"]
): Record<string, unknown> | undefined {
	if (!quote) {
		return undefined;
	}
	return {
		text: quote.text,
		position: quote.position,
		is_manual: quote.is_manual,
	};
}

export function buildTelegramSystemReminderMetadata(
	message: Message | undefined
): Record<string, unknown> | undefined {
	if (!message) {
		return undefined;
	}
	return {
		current_message: {
			message_id: message.message_id,
			from: buildTelegramUserMetadata(message.from),
			sender_chat: buildTelegramChatMetadata(message.sender_chat),
			chat: buildTelegramChatMetadata(message.chat),
			message_thread_id: message.message_thread_id,
			is_topic_message: message.is_topic_message,
			is_automatic_forward: message.is_automatic_forward,
		},
		reply_to_message: buildTelegramReplyToMessageMetadata(
			message.reply_to_message
		),
		external_reply: buildTelegramExternalReplyMetadata(
			message.external_reply
		),
		quote: buildTelegramQuoteMetadata(message.quote),
		forward_origin: buildTelegramOriginMetadata(message.forward_origin),
	};
}

async function saveTelegramInboundAttachment(params: {
	bot: Pick<TelegramPollingBot, "downloadFile">;
	workspaceDir: string;
	updateId: number;
	index: number;
	attachment: TelegramInboundAttachment;
	chatId: string;
	telegramChatId: string;
	telegramMessageId: string;
}): Promise<{
	kind: "image" | "file";
	absolutePath: string;
	contentType?: string;
	data: Uint8Array;
}> {
	const downloaded = await params.bot.downloadFile(params.attachment.fileId);
	const datePrefix = buildTelegramInboxDatePrefix(new Date());
	const inboxDir = join(
		getChatInboxDirectoryPath(params.workspaceDir),
		datePrefix
	);
	mkdirSync(inboxDir, { recursive: true });
	const fileName = resolveTelegramAttachmentFileName({
		attachment: params.attachment,
		downloaded,
		index: params.index,
	});
	const absolutePath = join(
		inboxDir,
		`${String(params.updateId)}-${String(params.index + 1)}-${fileName}`
	);
	writeFileSync(absolutePath, downloaded.data);
	log.debug("telegram.attachment.saved", {
		chatId: params.chatId,
		telegramChatId: params.telegramChatId,
		telegramMessageId: params.telegramMessageId,
		telegramUpdateId: String(params.updateId),
		attachmentKind: params.attachment.kind,
		attachmentPath: absolutePath,
		attachmentSizeBytes: downloaded.data.byteLength,
	});
	return {
		kind: params.attachment.kind,
		absolutePath,
		contentType: params.attachment.mimeType ?? downloaded.contentType,
		data: downloaded.data,
	};
}

async function buildTelegramInboundAgentContent(params: {
	bot: Pick<TelegramPollingBot, "downloadFile">;
	workspaceDir: string;
	chatId: string;
	telegramChatId: string;
	context: TelegramTextMessageContext;
	systemReminderMetadata: Record<string, unknown> | undefined;
}): Promise<string | (TextContent | ImageContent)[]> {
	if (params.context.message.attachments.length === 0) {
		const currentMessageText = sanitizeInboundTextOrThrow(
			params.context.message.text ?? ""
		);
		return appendPhiSystemReminderToUserContent(
			currentMessageText,
			buildPhiSystemReminder(params.systemReminderMetadata)
		);
	}

	const savedAttachments = await Promise.all(
		params.context.message.attachments.map((attachment, index) =>
			saveTelegramInboundAttachment({
				bot: params.bot,
				workspaceDir: params.workspaceDir,
				updateId: params.context.updateId,
				index,
				attachment,
				chatId: params.chatId,
				telegramChatId: params.telegramChatId,
				telegramMessageId: String(params.context.message.id),
			})
		)
	);
	const imageContents: ImageContent[] = [];
	const attachmentPaths: string[] = [];
	for (const attachment of savedAttachments) {
		attachmentPaths.push(attachment.absolutePath);
		if (attachment.kind === "image") {
			imageContents.push({
				type: "image",
				mimeType: attachment.contentType ?? "image/jpeg",
				data: Buffer.from(attachment.data).toString("base64"),
			});
		}
	}

	const inboundText = buildTelegramInboundText({
		text: params.context.message.text,
		attachmentPaths,
		imageCount: imageContents.length,
	});
	const sanitizedInboundText = sanitizeInboundTextOrThrow(inboundText);
	if (imageContents.length === 0) {
		return appendPhiSystemReminderToUserContent(
			sanitizedInboundText,
			buildPhiSystemReminder(params.systemReminderMetadata)
		);
	}
	return appendPhiSystemReminderToUserContent(
		[{ type: "text", text: sanitizedInboundText }, ...imageContents],
		buildPhiSystemReminder(params.systemReminderMetadata)
	);
}

function shouldShowTypingForEvent(event: AgentSessionEvent): boolean {
	if (event.type !== "message_update") {
		return false;
	}
	if (event.message.role !== "assistant") {
		return false;
	}

	switch (event.assistantMessageEvent.type) {
		case "thinking_start":
		case "thinking_delta":
		case "thinking_end":
		case "text_start":
		case "text_delta":
		case "text_end":
			return true;
		default:
			return false;
	}
}

function createTypingNotifier(sendTyping: () => Promise<unknown>): {
	notify(): void;
	stop(): void;
} {
	let stopped = false;
	let sending = false;
	let lastSentAt = 0;

	return {
		notify(): void {
			if (stopped || sending) {
				return;
			}
			if (Date.now() - lastSentAt < TYPING_INTERVAL_MS) {
				return;
			}

			sending = true;
			void sendTyping().then(
				() => {
					sending = false;
					lastSentAt = Date.now();
				},
				() => {
					sending = false;
					lastSentAt = Date.now();
				}
			);
		},
		stop(): void {
			stopped = true;
		},
	};
}

async function replyTextInChunks(
	bot: Pick<TelegramPollingBot, "sendText">,
	chatId: string,
	text: string,
	replyToMessageId?: string
): Promise<void> {
	const sanitized = sanitizeOutboundText(text);
	const chunks = chunkTextForOutbound(sanitized, TELEGRAM_TEXT_LIMIT);
	if (chunks.length === 0) {
		throw new Error("Outbound message is empty after sanitization.");
	}
	for (const [index, chunk] of chunks.entries()) {
		await bot.sendText(
			chatId,
			chunk,
			index === 0 ? replyToMessageId : undefined
		);
	}
}

async function isTelegramImageAttachment(
	attachment: PhiMessageAttachment
): Promise<boolean> {
	const contentType = Bun.file(attachment.path).type;
	return contentType.startsWith("image/");
}

async function sendTelegramAttachment(
	bot: Pick<TelegramPollingBot, "sendDocument" | "sendPhoto">,
	chatId: string,
	attachment: PhiMessageAttachment,
	caption?: string,
	replyToMessageId?: string
): Promise<void> {
	if (await isTelegramImageAttachment(attachment)) {
		await bot.sendPhoto(
			chatId,
			attachment.path,
			attachment.name,
			caption,
			replyToMessageId
		);
		return;
	}
	await bot.sendDocument(
		chatId,
		attachment.path,
		attachment.name,
		caption,
		replyToMessageId
	);
}

function buildTelegramMentionText(
	mentions: PhiMessageMention[] | undefined,
	requireUsername: boolean
): string | undefined {
	if (!mentions || mentions.length === 0) {
		return undefined;
	}
	return mentions
		.map((mention) => {
			if (mention.username) {
				return `@${mention.username}`;
			}
			if (requireUsername) {
				throw new Error(
					`Telegram mention requires username for user ${mention.userId}`
				);
			}
			return mention.displayName ?? mention.userId;
		})
		.join(" ");
}

function buildTelegramRenderedText(
	message: PhiMessage,
	requireUsername: boolean
): string | undefined {
	const mentionText = buildTelegramMentionText(
		message.mentions,
		requireUsername
	);
	const text = message.text?.trim();
	if (mentionText && text) {
		return `${mentionText}\n\n${text}`;
	}
	return mentionText ?? text;
}

function buildTelegramOutboundLogText(messages: PhiMessage[]): string {
	return messages
		.map((message) => {
			const attachmentText = message.attachments
				.map((attachment) => attachment.name)
				.join(", ");
			const text = buildTelegramRenderedText(message, false);
			if (text && attachmentText) {
				return `${text}\n[attachments: ${attachmentText}]`;
			}
			return text ?? `[attachments: ${attachmentText}]`;
		})
		.join("\n\n")
		.trim();
}

async function deliverTelegramMessage(
	bot: Pick<TelegramPollingBot, "sendDocument" | "sendPhoto" | "sendText">,
	chatId: string,
	message: PhiMessage
): Promise<void> {
	const renderedText = buildTelegramRenderedText(message, true);
	if (message.attachments.length === 0) {
		if (!renderedText) {
			throw new Error("Telegram outbound message is empty.");
		}
		await replyTextInChunks(
			bot,
			chatId,
			renderedText,
			message.replyToMessageId
		);
		log.debug("telegram.message.delivered", {
			telegramChatId: chatId,
			replyToMessageId: message.replyToMessageId,
			attachmentCount: 0,
			textLength: renderedText.length,
		});
		return;
	}

	const sanitizedText = renderedText
		? sanitizeOutboundText(renderedText)
		: undefined;
	const canUseCaption =
		typeof sanitizedText === "string" &&
		sanitizedText.length > 0 &&
		sanitizedText.length <= TELEGRAM_CAPTION_LIMIT;

	if (sanitizedText && !canUseCaption) {
		await replyTextInChunks(
			bot,
			chatId,
			sanitizedText,
			message.replyToMessageId
		);
	}

	for (const [index, attachment] of message.attachments.entries()) {
		const caption =
			index === 0 && canUseCaption ? sanitizedText : undefined;
		await sendTelegramAttachment(
			bot,
			chatId,
			attachment,
			caption,
			message.replyToMessageId
		);
	}
	log.debug("telegram.message.delivered", {
		telegramChatId: chatId,
		replyToMessageId: message.replyToMessageId,
		attachmentCount: message.attachments.length,
		textLength: sanitizedText?.length,
	});
}

class GrammyPollingBot implements TelegramPollingBot {
	private readonly bot: Bot;

	public constructor(token: string) {
		this.bot = new Bot(token);
	}

	public onTextMessage(
		handler: (context: TelegramTextMessageContext) => Promise<void>
	): void {
		this.bot.on("message", async (context: Context) => {
			const message = context.message;
			if (!message) {
				return;
			}
			const chat = context.chat;
			if (!chat) {
				throw new Error("Telegram update is missing chat information.");
			}
			const attachments: TelegramInboundAttachment[] = [];
			const photo = "photo" in message ? message.photo : undefined;
			if (Array.isArray(photo) && photo.length > 0) {
				const largestPhoto = photo[photo.length - 1];
				if (largestPhoto?.file_id) {
					attachments.push({
						fileId: largestPhoto.file_id,
						kind: "image",
						mimeType: "image/jpeg",
					});
				}
			}
			const document =
				"document" in message ? message.document : undefined;
			if (document?.file_id) {
				attachments.push({
					fileId: document.file_id,
					fileName: document.file_name,
					mimeType: document.mime_type,
					kind:
						typeof document.mime_type === "string" &&
						document.mime_type.startsWith("image/")
							? "image"
							: "file",
				});
			}
			const text =
				typeof message.text === "string"
					? message.text
					: typeof message.caption === "string"
						? message.caption
						: undefined;
			const systemReminderMetadata = buildTelegramSystemReminderMetadata(
				message as Message
			);
			if (!text && attachments.length === 0) {
				return;
			}
			await handler({
				updateId: context.update.update_id,
				chat: { id: chat.id },
				message: {
					id: message.message_id,
					text,
					attachments,
					sender: buildTelegramSenderMention(message.from),
					systemReminderMetadata,
				},
				reply: async (text: string) => {
					return context.reply(text);
				},
				sendTyping: async () => {
					return context.api.sendChatAction(chat.id, "typing");
				},
			});
		});
	}

	public onError(handler: (error: unknown) => void): void {
		this.bot.catch((error: BotError<Context>) => {
			handler(error.error);
		});
	}

	public async sendText(
		chatId: string,
		text: string,
		replyToMessageId?: string
	): Promise<unknown> {
		return await this.bot.api.sendMessage(chatId, text, {
			...buildTelegramReplyParams(replyToMessageId),
		});
	}

	public async sendPhoto(
		chatId: string,
		filePath: string,
		fileName: string,
		caption?: string,
		replyToMessageId?: string
	): Promise<unknown> {
		return await this.bot.api.sendPhoto(
			chatId,
			new InputFile(filePath, fileName),
			{
				...(caption ? { caption } : {}),
				...buildTelegramReplyParams(replyToMessageId),
			}
		);
	}

	public async sendDocument(
		chatId: string,
		filePath: string,
		fileName: string,
		caption?: string,
		replyToMessageId?: string
	): Promise<unknown> {
		return await this.bot.api.sendDocument(
			chatId,
			new InputFile(filePath, fileName),
			{
				...(caption ? { caption } : {}),
				...buildTelegramReplyParams(replyToMessageId),
			}
		);
	}

	public async downloadFile(fileId: string): Promise<DownloadedTelegramFile> {
		const file = await this.bot.api.getFile(fileId);
		if (!file.file_path) {
			throw new Error(`Telegram file path missing for file ${fileId}`);
		}
		const response = await fetch(
			`https://api.telegram.org/file/bot${this.bot.api.token}/${file.file_path}`
		);
		if (!response.ok) {
			throw new Error(
				`Telegram file download failed: ${response.status} ${response.statusText}`
			);
		}
		return {
			data: new Uint8Array(await response.arrayBuffer()),
			filePath: file.file_path,
			contentType: response.headers.get("content-type") ?? undefined,
		};
	}

	public async start(): Promise<void> {
		await this.bot.start({
			drop_pending_updates: false,
		});
	}

	public async stop(): Promise<void> {
		await this.bot.stop();
	}
}

const defaultTelegramServiceDependencies: TelegramServiceDependencies = {
	createBot(token: string): TelegramPollingBot {
		return new GrammyPollingBot(token);
	},
};

async function processTelegramAgentTurn(
	runtime: ChatSessionRuntime<AgentSession>,
	bot: Pick<TelegramPollingBot, "downloadFile">,
	target: TelegramRouteTarget,
	context: TelegramTextMessageContext
): Promise<PhiMessage[]> {
	const turnStartedAt = Date.now();
	const telegramChatId = normalizeTelegramChatId(context.chat.id);
	const telegramMessageId = normalizeTelegramMessageId(context.message.id);
	const telegramUpdateId = normalizeTelegramUpdateId(context.updateId);
	const turnContext: PhiTurnContext = {
		currentMessageId: telegramMessageId,
		sender: context.message.sender,
	};
	log.info("telegram.turn.started", {
		chatId: target.chatId,
		telegramChatId,
		telegramMessageId,
		telegramUpdateId,
		attachmentCount: context.message.attachments.length,
		textLength: context.message.text?.length,
	});
	const inboundContent = await buildTelegramInboundAgentContent({
		bot,
		workspaceDir: resolveChatWorkspaceDirectory(target.workspace),
		chatId: target.chatId,
		telegramChatId,
		context,
		systemReminderMetadata: context.message.systemReminderMetadata,
	});

	const session = await runtime.getOrCreateSession(target.chatId);
	getPhiMessagingSessionState(session)?.startTurn(turnContext);
	const typingNotifier = createTypingNotifier(context.sendTyping);
	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		if (shouldShowTypingForEvent(event)) {
			typingNotifier.notify();
		}
	});

	try {
		typingNotifier.notify();
		await session.sendUserMessage(inboundContent);
	} finally {
		unsubscribe();
		typingNotifier.stop();
	}

	const assistantText = session.getLastAssistantText();
	if (!assistantText) {
		throw new Error(
			`Assistant returned empty response for chat ${target.chatId}`
		);
	}

	const outboundMessages = resolvePhiSessionTurnOutput(
		session,
		assistantText
	);
	log.info("telegram.turn.completed", {
		chatId: target.chatId,
		telegramChatId,
		telegramMessageId,
		telegramUpdateId,
		outboundMessageCount: outboundMessages.length,
		durationMs: Date.now() - turnStartedAt,
	});
	return outboundMessages;
}

async function handleTelegramTextMessage(
	runtime: ChatSessionRuntime<AgentSession>,
	bot: TelegramPollingBot,
	chatRoutes: Record<string, TelegramRouteTarget>,
	context: TelegramTextMessageContext
): Promise<void> {
	const startedAt = Date.now();
	const telegramChatId = normalizeTelegramChatId(context.chat.id);
	const target = chatRoutes[telegramChatId];
	if (!target) {
		throw new Error(
			`No agent configured for telegram chat id: ${telegramChatId}`
		);
	}

	const workspaceDir = resolveChatWorkspaceDirectory(target.workspace);
	ensureChatWorkspaceLayout(workspaceDir);
	const idempotencyKey = createTelegramIdempotencyKey(
		telegramChatId,
		context.updateId
	);
	const telegramUpdateId = normalizeTelegramUpdateId(context.updateId);
	const telegramMessageId = normalizeTelegramMessageId(context.message.id);
	log.info("telegram.message.received", {
		chatId: target.chatId,
		telegramChatId,
		telegramUpdateId,
		telegramMessageId,
		idempotencyKey,
		attachmentCount: context.message.attachments.length,
		textLength: context.message.text?.length,
	});
	if (hasOutboundChatLogEntry(idempotencyKey)) {
		log.warn("telegram.message.duplicate_skipped", {
			chatId: target.chatId,
			telegramChatId,
			telegramUpdateId,
			telegramMessageId,
			idempotencyKey,
		});
		return;
	}

	appendChatLogEntry({
		idempotencyKey,
		channel: "telegram",
		chatId: target.chatId,
		telegramChatId,
		telegramUpdateId,
		telegramMessageId,
		direction: "inbound",
		source: "user",
		text: buildTelegramInboundLogText(context.message),
	});

	let outboundMessages: PhiMessage[];
	let outboundSource: "assistant" | "error" = "assistant";

	try {
		outboundMessages = await processTelegramAgentTurn(
			runtime,
			bot,
			target,
			context
		);
	} catch (error: unknown) {
		log.error("telegram.message.failed", {
			chatId: target.chatId,
			telegramChatId,
			telegramUpdateId,
			telegramMessageId,
			idempotencyKey,
			durationMs: Date.now() - startedAt,
			err: normalizeUnknownError(error),
		});
		outboundMessages = [
			{
				text: formatUserFacingErrorMessage(error),
				attachments: [],
				replyToMessageId: telegramMessageId,
			},
		];
		outboundSource = "error";
	}

	for (const message of outboundMessages) {
		await deliverTelegramMessage(bot, telegramChatId, message);
	}
	appendChatLogEntry({
		idempotencyKey,
		channel: "telegram",
		chatId: target.chatId,
		telegramChatId,
		telegramUpdateId,
		telegramMessageId,
		direction: "outbound",
		source: outboundSource,
		text: buildTelegramOutboundLogText(outboundMessages),
	});
	log.info("telegram.message.completed", {
		chatId: target.chatId,
		telegramChatId,
		telegramUpdateId,
		telegramMessageId,
		idempotencyKey,
		outboundSource,
		outboundMessageCount: outboundMessages.length,
		durationMs: Date.now() - startedAt,
	});
}

export async function startTelegramPollingBot(
	runtime: ChatSessionRuntime<AgentSession>,
	config: ResolvedTelegramPollingBotConfig,
	chatExecutorOrDependencies:
		| ChatExecutor
		| TelegramServiceDependencies = new InMemoryChatExecutor(),
	dependenciesArg: TelegramServiceDependencies = defaultTelegramServiceDependencies,
	deliveryRegistry?: PhiRouteDeliveryRegistry
): Promise<RunningTelegramPollingBot> {
	const chatExecutor =
		"run" in chatExecutorOrDependencies
			? chatExecutorOrDependencies
			: new InMemoryChatExecutor();
	const dependencies =
		"run" in chatExecutorOrDependencies
			? dependenciesArg
			: chatExecutorOrDependencies;
	const bot = dependencies.createBot(config.token);
	log.info("telegram.bot.starting", {
		routeCount: Object.keys(config.chatRoutes).length,
		chatIds: Object.values(config.chatRoutes).map(
			(target) => target.chatId
		),
	});

	bot.onError((error: unknown) => {
		const normalizedError = normalizeUnknownError(error);
		log.error("telegram.bot.error", {
			err: normalizedError,
			routeCount: Object.keys(config.chatRoutes).length,
		});
		queueMicrotask(() => {
			throw normalizedError;
		});
	});

	const unregisterDeliveries = deliveryRegistry
		? Object.entries(config.chatRoutes).map(([telegramChatId, target]) =>
				deliveryRegistry.register(target.chatId, {
					deliver: async (message: PhiMessage) => {
						await deliverTelegramMessage(
							bot,
							telegramChatId,
							message
						);
					},
				})
			)
		: [];

	bot.onTextMessage(async (context: TelegramTextMessageContext) => {
		const telegramChatId = normalizeTelegramChatId(context.chat.id);
		const queueKey =
			config.chatRoutes[telegramChatId]?.chatId ?? telegramChatId;
		await chatExecutor.run(queueKey, async () => {
			try {
				await handleTelegramTextMessage(
					runtime,
					bot,
					config.chatRoutes,
					context
				);
			} catch (error: unknown) {
				log.error("telegram.message.unhandled_failure", {
					telegramChatId,
					telegramUpdateId: normalizeTelegramUpdateId(
						context.updateId
					),
					telegramMessageId: normalizeTelegramMessageId(
						context.message.id
					),
					err: normalizeUnknownError(error),
				});
				await replyTextInChunks(
					bot,
					telegramChatId,
					formatUserFacingErrorMessage(error)
				);
			}
		});
	});

	const done = bot
		.start()
		.then(
			() => {
				log.info("telegram.bot.started", {
					routeCount: Object.keys(config.chatRoutes).length,
				});
			},
			(error: unknown) => {
				log.error("telegram.bot.start_failed", {
					err: normalizeUnknownError(error),
					routeCount: Object.keys(config.chatRoutes).length,
				});
				throw error;
			}
		)
		.finally(() => {
			log.info("telegram.bot.stopped", {
				routeCount: Object.keys(config.chatRoutes).length,
			});
			for (const unregister of unregisterDeliveries) {
				unregister();
			}
			for (const target of Object.values(config.chatRoutes)) {
				runtime.disposeSession(target.chatId);
			}
		});

	return {
		done,
		async stop(): Promise<void> {
			await bot.stop();
		},
	};
}
