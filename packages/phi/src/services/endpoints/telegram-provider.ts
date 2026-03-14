import { Bot, type Context, InputFile } from "grammy";
import type {
	ExternalReplyInfo,
	Message,
	MessageOrigin,
} from "@grammyjs/types";

import { getPhiLogger } from "@phi/core/logger";
import { sanitizeOutboundText } from "@phi/core/message-text";
import {
	formatUserFacingErrorMessage,
	normalizeUnknownError,
} from "@phi/core/user-error";

import {
	chunkAndSend,
	createHashedInstanceId,
	createIdempotencyKey,
	DedupSet,
	isImageAttachment,
	saveInboundAttachment,
} from "./shared.js";
import type {
	EndpointAttachment,
	EndpointInboundContext,
	EndpointOutboundMessage,
	EndpointProvider,
} from "./types.js";

const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_CAPTION_LIMIT = 1024;

const log = getPhiLogger("telegram-provider");

export interface TelegramRouteTarget {
	sessionId: string;
	chatId: string;
	workspace: string;
}

interface TelegramInboundAttachment {
	fileId: string;
	fileName?: string;
	mimeType?: string;
}

interface DownloadedFile {
	data: Uint8Array;
	filePath: string;
	contentType?: string;
}

export interface TelegramBotApi {
	sendMessage(
		chatId: string,
		text: string,
		params?: Record<string, unknown>
	): Promise<unknown>;
	sendPhoto(
		chatId: string,
		photo: unknown,
		params?: Record<string, unknown>
	): Promise<unknown>;
	sendDocument(
		chatId: string,
		document: unknown,
		params?: Record<string, unknown>
	): Promise<unknown>;
	sendChatAction(chatId: string, action: string): Promise<unknown>;
	getFile(fileId: string): Promise<{ file_path?: string }>;
	readonly token: string;
}

export interface TelegramBotLike {
	api: TelegramBotApi;
	on(event: unknown, handler: unknown): void;
	catch(handler: unknown): void;
	start(params?: Record<string, unknown>): Promise<void>;
	stop(): Promise<void>;
}

export type TelegramBotFactory = (token: string) => TelegramBotLike;

interface TelegramInboundCallbacks {
	shouldProcess(routeId: string): boolean;
	resolveWorkspace(routeId: string): string;
	onSuccess(
		routeId: string,
		updateId: number,
		messageId: string,
		text?: string,
		attachments?: EndpointAttachment[]
	): void;
	onError(
		routeId: string,
		updateId: number,
		messageId: string,
		error: unknown
	): void;
}

function createInstanceId(token: string): string {
	return createHashedInstanceId("tg", token);
}

type ReplyMessage = NonNullable<Message["reply_to_message"]>;

function buildUserMetadata(
	user: Context["from"]
): Record<string, unknown> | undefined {
	if (!user) return undefined;
	return {
		id: user.id,
		username: user.username,
		first_name: user.first_name,
		last_name: user.last_name,
	};
}

function buildChatMetadata(
	chat: Message["chat"] | Message["sender_chat"] | ExternalReplyInfo["chat"]
): Record<string, unknown> | undefined {
	if (!chat) return undefined;
	return {
		id: chat.id,
		type: chat.type,
		title: "title" in chat ? chat.title : undefined,
		username: "username" in chat ? chat.username : undefined,
	};
}

function buildOriginMetadata(
	origin: MessageOrigin | undefined
): Record<string, unknown> | undefined {
	if (!origin) return undefined;
	switch (origin.type) {
		case "user":
			return {
				type: origin.type,
				date: origin.date,
				sender_user: buildUserMetadata(origin.sender_user),
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
				sender_chat: buildChatMetadata(origin.sender_chat),
				author_signature: origin.author_signature,
			};
		case "channel":
			return {
				type: origin.type,
				date: origin.date,
				chat: buildChatMetadata(origin.chat),
				message_id: origin.message_id,
				author_signature: origin.author_signature,
			};
	}
}

function buildAttachmentMetadata(
	message: ReplyMessage | ExternalReplyInfo | undefined
): Record<string, unknown> | undefined {
	if (!message) return undefined;
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

function buildTelegramMessageMetadata(
	message: Message | undefined
): Record<string, unknown> | undefined {
	if (!message) return undefined;
	return {
		current_message: {
			message_id: message.message_id,
			from: buildUserMetadata(message.from),
			sender_chat: buildChatMetadata(message.sender_chat),
			chat: buildChatMetadata(message.chat),
			message_thread_id: message.message_thread_id,
			is_topic_message: message.is_topic_message,
			is_automatic_forward: message.is_automatic_forward,
		},
		reply_to_message: message.reply_to_message
			? {
					message_id: message.reply_to_message.message_id,
					from: buildUserMetadata(message.reply_to_message.from),
					sender_chat: buildChatMetadata(
						message.reply_to_message.sender_chat
					),
					chat: buildChatMetadata(message.reply_to_message.chat),
					text: message.reply_to_message.text,
					caption: message.reply_to_message.caption,
					...buildAttachmentMetadata(message.reply_to_message),
				}
			: undefined,
		external_reply: message.external_reply
			? {
					message_id: message.external_reply.message_id,
					origin: buildOriginMetadata(message.external_reply.origin),
					chat: buildChatMetadata(message.external_reply.chat),
					...buildAttachmentMetadata(message.external_reply),
				}
			: undefined,
		quote: message.quote
			? {
					text: message.quote.text,
					position: message.quote.position,
					is_manual: message.quote.is_manual,
				}
			: undefined,
		forward_origin: buildOriginMetadata(message.forward_origin),
	};
}

export class TelegramProvider implements EndpointProvider {
	readonly id = "telegram";
	readonly instanceId: string;

	private bot: TelegramBotLike | undefined;
	private readonly dedup = new DedupSet();
	private closed = false;
	private fatalReject: ((err: unknown) => void) | undefined;

	private constructor(
		private readonly token: string,
		private readonly botFactory: TelegramBotFactory,
		private readonly callbacks: TelegramInboundCallbacks,
		private readonly messageHandler: (
			ctx: EndpointInboundContext
		) => Promise<void>
	) {
		this.instanceId = createInstanceId(token);
	}

	static create(options: {
		token: string;
		botFactory?: TelegramBotFactory;
		callbacks: TelegramInboundCallbacks;
		onMessage: (ctx: EndpointInboundContext) => Promise<void>;
	}): TelegramProvider {
		return new TelegramProvider(
			options.token,
			options.botFactory ?? ((token: string) => new Bot(token)),
			options.callbacks,
			options.onMessage
		);
	}

	async start(): Promise<void> {
		this.bot = this.botFactory(this.token);

		this.bot.on("message", async (ctx: Context) => {
			try {
				await this.handleUpdate(ctx);
			} catch (error: unknown) {
				const message = ctx.message;
				const chat = ctx.chat;
				const bot = this.bot;
				if (message && chat && bot) {
					const errorText = formatUserFacingErrorMessage(error);
					log.error("telegram.message.error", {
						routeId: String(chat.id),
						err: normalizeUnknownError(error),
					});
					try {
						await chunkAndSend(
							errorText,
							TELEGRAM_TEXT_LIMIT,
							async (chunk) => {
								await bot.api.sendMessage(
									String(chat.id),
									chunk,
									{
										reply_parameters: {
											message_id: message.message_id,
										},
									}
								);
							}
						);
					} catch {}
				}
			}
		});

		this.bot.catch((error: unknown) => {
			log.error("telegram.bot.fatal", {
				instanceId: this.instanceId,
				err: normalizeUnknownError(error),
			});
			this.fatalReject?.(error);
		});

		log.info("telegram.bot.starting", {
			instanceId: this.instanceId,
		});
		await this.bot.start({
			drop_pending_updates: false,
		});
	}

	async startWithFatalHandler(): Promise<void> {
		const fatalPromise = new Promise<never>((_, reject) => {
			this.fatalReject = reject;
		});
		await Promise.race([this.start(), fatalPromise]);
	}

	async stop(): Promise<void> {
		if (this.closed) {
			return;
		}
		this.closed = true;
		if (this.bot) {
			await this.bot.stop();
			this.bot = undefined;
		}
	}

	async send(
		chatId: string,
		message: EndpointOutboundMessage
	): Promise<void> {
		const bot = this.bot;
		if (!bot) {
			throw new Error("Telegram bot not started");
		}

		const text = message.text
			? sanitizeOutboundText(message.text)
			: undefined;
		let replyParams = message.replyToMessageId
			? {
					reply_parameters: {
						message_id: Number(message.replyToMessageId),
					},
				}
			: {};

		if (message.attachments.length === 0) {
			if (!text) {
				throw new Error("Telegram outbound message is empty.");
			}
			await chunkAndSend(text, TELEGRAM_TEXT_LIMIT, async (chunk) => {
				await bot.api.sendMessage(chatId, chunk, replyParams);
			});
			return;
		}

		const canUseCaption =
			typeof text === "string" &&
			text.length > 0 &&
			text.length <= TELEGRAM_CAPTION_LIMIT;

		if (text && !canUseCaption) {
			await chunkAndSend(text, TELEGRAM_TEXT_LIMIT, async (chunk) => {
				await bot.api.sendMessage(chatId, chunk, replyParams);
			});
			replyParams = {};
		}

		for (const [index, attachment] of message.attachments.entries()) {
			const caption = index === 0 && canUseCaption ? text : undefined;
			const inputFile = new InputFile(attachment.path, attachment.name);

			if (await isImageAttachment(attachment)) {
				await bot.api.sendPhoto(chatId, inputFile, {
					...(caption ? { caption } : {}),
					...replyParams,
				});
			} else {
				await bot.api.sendDocument(chatId, inputFile, {
					...(caption ? { caption } : {}),
					...replyParams,
				});
			}

			replyParams = {};
		}
	}

	private async handleUpdate(context: Context): Promise<void> {
		const bot = this.bot;
		if (!bot) {
			return;
		}

		const message = context.message;
		if (!message) {
			return;
		}

		const chat = context.chat;
		if (!chat) {
			throw new Error("Telegram update is missing chat information.");
		}

		const routeId = String(chat.id);
		if (!this.callbacks.shouldProcess(routeId)) {
			log.debug("telegram.message.no_route", { routeId });
			return;
		}

		const updateId = context.update.update_id;
		const dedupKey = createIdempotencyKey(this.id, routeId, updateId);
		if (this.dedup.has(dedupKey)) {
			log.debug("telegram.message.duplicate_skipped", {
				routeId,
				updateId,
			});
			return;
		}
		this.dedup.add(dedupKey);

		const rawAttachments: TelegramInboundAttachment[] = [];
		const photo = "photo" in message ? message.photo : undefined;
		if (Array.isArray(photo) && photo.length > 0) {
			const largest = photo[photo.length - 1];
			if (largest?.file_id) {
				rawAttachments.push({
					fileId: largest.file_id,
					mimeType: "image/jpeg",
				});
			}
		}
		const document = "document" in message ? message.document : undefined;
		if (document?.file_id) {
			rawAttachments.push({
				fileId: document.file_id,
				fileName: document.file_name,
				mimeType: document.mime_type,
			});
		}

		const text =
			typeof message.text === "string"
				? message.text
				: typeof message.caption === "string"
					? message.caption
					: undefined;

		if (!text && rawAttachments.length === 0) {
			return;
		}

		const metadata = buildTelegramMessageMetadata(message as Message);
		const workspace = this.callbacks.resolveWorkspace(routeId);
		const downloadedAttachments: EndpointAttachment[] = [];
		for (const [index, attachment] of rawAttachments.entries()) {
			const downloaded = await this.downloadFile(bot, attachment.fileId);
			const saved = saveInboundAttachment({
				data: downloaded.data,
				fileName: attachment.fileName,
				filePath: downloaded.filePath,
				contentType: attachment.mimeType ?? downloaded.contentType,
				workspace,
				prefix: `${String(updateId)}-${String(index + 1)}-`,
			});
			downloadedAttachments.push(saved);
		}

		const messageId = String(message.message_id);
		const inboundCtx: EndpointInboundContext = {
			endpointId: this.id,
			instanceId: this.instanceId,
			routeId,
			messageId,
			text,
			attachments: downloadedAttachments,
			metadata,
			replyToMessageId: message.reply_to_message
				? String(message.reply_to_message.message_id)
				: undefined,
			sendTyping: async () => {
				await context.api.sendChatAction(chat.id, "typing");
			},
		};

		try {
			await this.messageHandler(inboundCtx);
			this.callbacks.onSuccess(
				routeId,
				updateId,
				messageId,
				text,
				downloadedAttachments
			);
		} catch (error: unknown) {
			this.dedup.delete(dedupKey);
			this.callbacks.onError(routeId, updateId, messageId, error);
			throw error;
		}
	}

	private async downloadFile(
		bot: TelegramBotLike,
		fileId: string
	): Promise<DownloadedFile> {
		const file = await bot.api.getFile(fileId);
		if (!file.file_path) {
			throw new Error(`Telegram file path missing for file ${fileId}`);
		}
		const response = await fetch(
			`https://api.telegram.org/file/bot${bot.api.token}/${file.file_path}`
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
}
