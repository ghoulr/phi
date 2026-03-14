import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import type { Readable } from "node:stream";

import {
	Client,
	EventDispatcher,
	LoggerLevel,
	WSClient,
} from "@larksuiteoapi/node-sdk";

import { sanitizeOutboundText } from "@phi/core/message-text";
import { getPhiLogger } from "@phi/core/logger";
import { isRecord } from "@phi/core/type-guards";
import {
	formatUserFacingErrorMessage,
	normalizeUnknownError,
} from "@phi/core/user-error";

import {
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

const log = getPhiLogger("feishu-provider");
const FEISHU_TEXT_MESSAGE_TYPE = "text";
const FEISHU_IMAGE_MESSAGE_TYPE = "image";
const FEISHU_FILE_MESSAGE_TYPE = "file";
const FEISHU_MESSAGE_EVENT = "im.message.receive_v1";
const FEISHU_TEXT_PAYLOAD_LIMIT_BYTES = 150 * 1024;
const FEISHU_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_IMAGE_FILE_NAME = "image";
const DEFAULT_FILE_NAME = "attachment";

export interface FeishuRouteTarget {
	sessionId: string;
	chatId: string;
	workspace: string;
}

export interface FeishuMessageEvent {
	event_id?: string;
	tenant_key?: string;
	sender: {
		sender_id?: {
			union_id?: string;
			user_id?: string;
			open_id?: string;
		};
		sender_type: string;
		tenant_key?: string;
	};
	message: {
		message_id: string;
		root_id?: string;
		parent_id?: string;
		create_time: string;
		update_time?: string;
		chat_id: string;
		thread_id?: string;
		chat_type: string;
		message_type: string;
		content: string;
		mentions?: Array<{
			key: string;
			id: {
				union_id?: string;
				user_id?: string;
				open_id?: string;
			};
			name: string;
			tenant_key?: string;
		}>;
		user_agent?: string;
	};
}

interface FeishuImageUploadResponse {
	image_key?: string;
}

interface FeishuFileUploadResponse {
	file_key?: string;
}

interface FeishuDownloadResponse {
	getReadableStream(): Readable;
	headers: unknown;
}

interface SdkLoggerLike {
	error(...msg: unknown[]): void | Promise<void>;
	warn(...msg: unknown[]): void | Promise<void>;
	info(...msg: unknown[]): void | Promise<void>;
	debug(...msg: unknown[]): void | Promise<void>;
	trace(...msg: unknown[]): void | Promise<void>;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T | PromiseLike<T>): void;
	reject(reason?: unknown): void;
}

export interface FeishuClientLike {
	im: {
		v1: {
			message: {
				create(payload?: Record<string, unknown>): Promise<unknown>;
				reply(payload?: Record<string, unknown>): Promise<unknown>;
			};
			image: {
				create(payload?: Record<string, unknown>): Promise<unknown>;
			};
			file: {
				create(payload?: Record<string, unknown>): Promise<unknown>;
			};
			messageResource: {
				get(payload?: Record<string, unknown>): Promise<unknown>;
			};
		};
	};
}

export interface FeishuEventDispatcherLike {
	register(
		handles: Record<string, (event: FeishuMessageEvent) => Promise<unknown>>
	): this;
}

export interface FeishuWsClientLike {
	start(params: {
		eventDispatcher: FeishuEventDispatcherLike;
	}): Promise<void>;
	close(params?: { force?: boolean }): void;
}

export type FeishuClientFactory = (config: {
	appId: string;
	appSecret: string;
	logger?: SdkLoggerLike;
}) => FeishuClientLike;

export type FeishuEventDispatcherFactory = (config?: {
	logger?: SdkLoggerLike;
}) => FeishuEventDispatcherLike;

export type FeishuWsClientFactory = (config: {
	appId: string;
	appSecret: string;
	logger?: SdkLoggerLike;
}) => FeishuWsClientLike;

interface ParsedFeishuMessageContent {
	text?: string;
	attachment?: {
		resourceType: "image" | "file";
		resourceKey: string;
		fileName?: string;
	};
	raw: Record<string, unknown>;
}

interface FeishuInboundCallbacks {
	shouldProcess(routeId: string): boolean;
	resolveWorkspace(routeId: string): string;
	onSuccess(
		routeId: string,
		eventId: string,
		messageId: string,
		text?: string,
		attachments?: EndpointAttachment[]
	): void;
	onError(
		routeId: string,
		eventId: string,
		messageId: string,
		error: unknown
	): void;
}

function createInstanceId(appId: string): string {
	return createHashedInstanceId("fs", appId);
}

function createDeferred<T>(): Deferred<T> {
	let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
	let reject: ((reason?: unknown) => void) | undefined;
	const promise = new Promise<T>((innerResolve, innerReject) => {
		resolve = innerResolve;
		reject = innerReject;
	});
	if (!resolve || !reject) {
		throw new Error("Failed to initialize deferred.");
	}
	return { promise, resolve, reject };
}

function toContentRecord(content: string): Record<string, unknown> {
	const parsed = JSON.parse(content);
	if (!isRecord(parsed)) {
		throw new Error("Feishu message content must be an object.");
	}
	return parsed;
}

function parseMessageContent(
	event: FeishuMessageEvent
): ParsedFeishuMessageContent {
	const raw = toContentRecord(event.message.content);
	switch (event.message.message_type) {
		case FEISHU_TEXT_MESSAGE_TYPE: {
			const text = raw.text;
			return {
				text:
					typeof text === "string" && text.length > 0
						? text
						: undefined,
				raw,
			};
		}
		case FEISHU_IMAGE_MESSAGE_TYPE: {
			const imageKey = raw.image_key;
			if (typeof imageKey !== "string" || imageKey.length === 0) {
				throw new Error("Feishu image message is missing image_key.");
			}
			return {
				attachment: {
					resourceType: "image",
					resourceKey: imageKey,
					fileName: DEFAULT_IMAGE_FILE_NAME,
				},
				raw,
			};
		}
		case FEISHU_FILE_MESSAGE_TYPE: {
			const fileKey = raw.file_key;
			if (typeof fileKey !== "string" || fileKey.length === 0) {
				throw new Error("Feishu file message is missing file_key.");
			}
			const fileName = raw.file_name;
			return {
				attachment: {
					resourceType: "file",
					resourceKey: fileKey,
					fileName:
						typeof fileName === "string" && fileName.length > 0
							? fileName
							: DEFAULT_FILE_NAME,
				},
				raw,
			};
		}
		default:
			return { raw };
	}
}

function buildMessageMetadata(
	event: FeishuMessageEvent,
	parsedContent: ParsedFeishuMessageContent
): Record<string, unknown> {
	return {
		event_id: event.event_id,
		tenant_key: event.tenant_key,
		sender: event.sender,
		message: {
			message_id: event.message.message_id,
			root_id: event.message.root_id,
			parent_id: event.message.parent_id,
			create_time: event.message.create_time,
			update_time: event.message.update_time,
			chat_id: event.message.chat_id,
			thread_id: event.message.thread_id,
			chat_type: event.message.chat_type,
			message_type: event.message.message_type,
			mentions: event.message.mentions,
			user_agent: event.message.user_agent,
			content: parsedContent.raw,
		},
	};
}

function createDefaultClientFactory(): FeishuClientFactory {
	return (config) =>
		new Client({
			appId: config.appId,
			appSecret: config.appSecret,
			logger: config.logger,
			loggerLevel: LoggerLevel.info,
		});
}

function createDefaultEventDispatcherFactory(): FeishuEventDispatcherFactory {
	return (config) =>
		new EventDispatcher({
			logger: config?.logger,
			loggerLevel: LoggerLevel.info,
		});
}

function createDefaultWsClientFactory(): FeishuWsClientFactory {
	return (config) =>
		new WSClient({
			appId: config.appId,
			appSecret: config.appSecret,
			logger: config.logger,
			loggerLevel: LoggerLevel.info,
		});
}

function normalizeHeaderRecord(headers: unknown): Record<string, string> {
	if (!isRecord(headers)) {
		return {};
	}
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (typeof value === "string") {
			result[key.toLowerCase()] = value;
		}
	}
	return result;
}

function parseContentDispositionFileName(headers: unknown): string | undefined {
	const headerValue = normalizeHeaderRecord(headers)["content-disposition"];
	if (!headerValue) {
		return undefined;
	}
	const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
	if (utf8Match?.[1]) {
		return decodeURIComponent(utf8Match[1]);
	}
	const plainMatch = headerValue.match(/filename="?([^";]+)"?/i);
	if (plainMatch?.[1]) {
		return plainMatch[1];
	}
	return undefined;
}

function resolveContentType(headers: unknown): string | undefined {
	return normalizeHeaderRecord(headers)["content-type"];
}

async function readStreamFully(readable: Readable): Promise<Uint8Array> {
	const chunks: Buffer[] = [];
	for await (const chunk of readable) {
		if (typeof chunk === "string") {
			chunks.push(Buffer.from(chunk));
			continue;
		}
		chunks.push(Buffer.from(chunk));
	}
	return new Uint8Array(Buffer.concat(chunks));
}

function resolveFeishuFileType(
	fileName: string
): "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" {
	const extension = extname(fileName).toLowerCase();
	switch (extension) {
		case ".opus":
			return "opus";
		case ".mp4":
			return "mp4";
		case ".pdf":
			return "pdf";
		case ".doc":
		case ".docx":
			return "doc";
		case ".xls":
		case ".xlsx":
		case ".csv":
			return "xls";
		case ".ppt":
		case ".pptx":
			return "ppt";
		default:
			return "stream";
	}
}

function buildFeishuTextContent(text: string): string {
	return JSON.stringify({ text });
}

function splitFeishuText(text: string): string[] {
	const sanitized = sanitizeOutboundText(text);
	if (sanitized.length === 0) {
		return [];
	}
	if (
		Buffer.byteLength(buildFeishuTextContent(sanitized), "utf8") <=
		FEISHU_TEXT_PAYLOAD_LIMIT_BYTES
	) {
		return [sanitized];
	}
	const pieces: string[] = [];
	let remaining = sanitized;
	while (remaining.length > 0) {
		let low = 1;
		let high = remaining.length;
		let fit = 0;
		while (low <= high) {
			const mid = Math.floor((low + high) / 2);
			const candidate = remaining.slice(0, mid);
			if (
				Buffer.byteLength(buildFeishuTextContent(candidate), "utf8") <=
				FEISHU_TEXT_PAYLOAD_LIMIT_BYTES
			) {
				fit = mid;
				low = mid + 1;
				continue;
			}
			high = mid - 1;
		}
		if (fit <= 0) {
			throw new Error(
				"Feishu outbound text chunk exceeds payload limit."
			);
		}
		const window = remaining.slice(0, fit);
		const lastNewline = window.lastIndexOf("\n");
		const lastSpace = window.lastIndexOf(" ");
		const breakIdx =
			lastNewline > 0 ? lastNewline : lastSpace > 0 ? lastSpace : fit;
		const rawPiece = remaining.slice(0, breakIdx);
		const piece = rawPiece.trimEnd() || remaining.slice(0, fit);
		pieces.push(piece);
		remaining = remaining.slice(piece.length).trimStart();
	}
	return pieces;
}

async function readAttachmentBytes(path: string): Promise<Uint8Array> {
	return new Uint8Array(await Bun.file(path).arrayBuffer());
}

export const __test__ = {
	buildFeishuTextContent,
	parseContentDispositionFileName,
	parseMessageContent,
	resolveFeishuFileType,
	splitFeishuText,
};

export class FeishuProvider implements EndpointProvider {
	readonly id = "feishu";
	readonly instanceId: string;

	private readonly client: FeishuClientLike;
	private readonly eventDispatcher: FeishuEventDispatcherLike;
	private readonly wsClient: FeishuWsClientLike;
	private readonly dedup = new DedupSet();
	private readonly startupDeferred = createDeferred<void>();
	private readonly doneDeferred = createDeferred<void>();
	private started = false;
	private closed = false;
	private startupSettled = false;
	private doneSettled = false;

	private constructor(
		private readonly appId: string,
		private readonly callbacks: FeishuInboundCallbacks,
		private readonly messageHandler: (
			ctx: EndpointInboundContext
		) => Promise<void>,
		client: FeishuClientLike,
		eventDispatcher: FeishuEventDispatcherLike,
		wsClient: FeishuWsClientLike
	) {
		this.instanceId = createInstanceId(appId);
		this.client = client;
		this.eventDispatcher = eventDispatcher;
		this.wsClient = wsClient;
		void this.doneDeferred.promise.catch(() => {});
	}

	static create(options: {
		appId: string;
		appSecret: string;
		clientFactory?: FeishuClientFactory;
		eventDispatcherFactory?: FeishuEventDispatcherFactory;
		wsClientFactory?: FeishuWsClientFactory;
		callbacks: FeishuInboundCallbacks;
		onMessage: (ctx: EndpointInboundContext) => Promise<void>;
	}): FeishuProvider {
		const clientFactory =
			options.clientFactory ?? createDefaultClientFactory();
		const eventDispatcherFactory =
			options.eventDispatcherFactory ??
			createDefaultEventDispatcherFactory();
		const wsClientFactory =
			options.wsClientFactory ?? createDefaultWsClientFactory();
		let provider: FeishuProvider | undefined;
		const sdkLogger: SdkLoggerLike = {
			error(...msg: unknown[]): void {
				provider?.handleSdkError(msg);
			},
			warn(...msg: unknown[]): void {
				provider?.handleSdkWarn(msg);
			},
			info(...msg: unknown[]): void {
				provider?.handleSdkInfo(msg);
			},
			debug(...msg: unknown[]): void {
				provider?.handleSdkDebug(msg);
			},
			trace(..._msg: unknown[]): void {},
		};
		provider = new FeishuProvider(
			options.appId,
			options.callbacks,
			options.onMessage,
			clientFactory({
				appId: options.appId,
				appSecret: options.appSecret,
				logger: sdkLogger,
			}),
			eventDispatcherFactory({ logger: sdkLogger }),
			wsClientFactory({
				appId: options.appId,
				appSecret: options.appSecret,
				logger: sdkLogger,
			})
		);
		return provider;
	}

	get done(): Promise<void> {
		return this.doneDeferred.promise;
	}

	async start(): Promise<void> {
		if (this.started) {
			return;
		}
		this.closed = false;
		this.eventDispatcher.register({
			[FEISHU_MESSAGE_EVENT]: async (event: FeishuMessageEvent) => {
				try {
					await this.handleEvent(event);
				} catch (error: unknown) {
					log.error("feishu.message.error", {
						routeId: event.message.chat_id,
						err: normalizeUnknownError(error),
					});
					await this.replyWithError(event.message.message_id, error);
				}
			},
		});
		log.info("feishu.ws.starting", {
			instanceId: this.instanceId,
			appId: this.appId,
		});
		await this.wsClient.start({ eventDispatcher: this.eventDispatcher });
	}

	async startWithFatalHandler(): Promise<void> {
		await this.start();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.startupDeferred.promise,
				new Promise<never>((_, reject) => {
					timeout = setTimeout(() => {
						reject(
							new Error(
								`Feishu websocket startup timed out for app ${this.appId}`
							)
						);
					}, FEISHU_STARTUP_TIMEOUT_MS);
				}),
			]);
		} catch (error: unknown) {
			this.failRuntime(error);
			throw error;
		} finally {
			if (timeout) {
				clearTimeout(timeout);
			}
		}
		this.started = true;
	}

	async stop(): Promise<void> {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.started = false;
		this.wsClient.close();
		this.resolveStartup();
		this.resolveDone();
	}

	private resolveStartup(): void {
		if (this.startupSettled) {
			return;
		}
		this.startupSettled = true;
		this.startupDeferred.resolve();
	}

	private rejectStartup(error: unknown): void {
		if (this.startupSettled) {
			return;
		}
		this.startupSettled = true;
		this.startupDeferred.reject(error);
	}

	private resolveDone(): void {
		if (this.doneSettled) {
			return;
		}
		this.doneSettled = true;
		this.doneDeferred.resolve();
	}

	private rejectDone(error: unknown): void {
		if (this.doneSettled) {
			return;
		}
		this.doneSettled = true;
		this.doneDeferred.reject(error);
	}

	private failRuntime(error: unknown): void {
		if (this.closed) {
			return;
		}
		this.rejectStartup(error);
		this.rejectDone(error);
	}

	private handleSdkInfo(messages: unknown[]): void {
		const message = messages.map(String).join(" ");
		if (message.includes("ws client ready")) {
			this.resolveStartup();
		}
		log.debug("feishu.sdk.info", { instanceId: this.instanceId, message });
	}

	private handleSdkWarn(messages: unknown[]): void {
		const message = messages.map(String).join(" ");
		log.warn("feishu.sdk.warn", { instanceId: this.instanceId, message });
	}

	private handleSdkDebug(messages: unknown[]): void {
		const message = messages.map(String).join(" ");
		log.debug("feishu.sdk.debug", { instanceId: this.instanceId, message });
	}

	private handleSdkError(messages: unknown[]): void {
		const message = messages.map(String).join(" ");
		log.error("feishu.sdk.error", {
			instanceId: this.instanceId,
			message,
		});
		if (
			message.includes("unable to connect to the server after trying") ||
			message.includes("client need to start with a eventDispatcher")
		) {
			this.failRuntime(new Error(`Feishu websocket failed: ${message}`));
		}
	}

	async send(
		chatId: string,
		message: EndpointOutboundMessage
	): Promise<void> {
		if (!this.started) {
			throw new Error("Feishu client not started");
		}

		if (!message.text && message.attachments.length === 0) {
			throw new Error("Feishu outbound message is empty.");
		}

		const text = message.text
			? sanitizeOutboundText(message.text)
			: undefined;
		let canReply = Boolean(message.replyToMessageId);

		const sendPayload = async (params: {
			msgType: string;
			content: Record<string, unknown>;
		}): Promise<void> => {
			if (canReply && message.replyToMessageId) {
				await this.client.im.v1.message.reply({
					path: {
						message_id: message.replyToMessageId,
					},
					data: {
						content: JSON.stringify(params.content),
						msg_type: params.msgType,
						uuid: randomUUID(),
					},
				});
				canReply = false;
				return;
			}
			await this.client.im.v1.message.create({
				params: {
					receive_id_type: "chat_id",
				},
				data: {
					receive_id: chatId,
					content: JSON.stringify(params.content),
					msg_type: params.msgType,
					uuid: randomUUID(),
				},
			});
		};

		if (text) {
			for (const chunk of splitFeishuText(text)) {
				await sendPayload({
					msgType: FEISHU_TEXT_MESSAGE_TYPE,
					content: { text: chunk },
				});
			}
		}

		for (const attachment of message.attachments) {
			const attachmentBytes = await readAttachmentBytes(attachment.path);
			if (await isImageAttachment(attachment)) {
				const uploadResult = (await this.client.im.v1.image.create({
					data: {
						image_type: "message",
						image: Buffer.from(attachmentBytes),
					},
				})) as FeishuImageUploadResponse | null;
				const imageKey = uploadResult?.image_key;
				if (!imageKey) {
					throw new Error(
						`Feishu image upload failed for ${attachment.path}`
					);
				}
				await sendPayload({
					msgType: FEISHU_IMAGE_MESSAGE_TYPE,
					content: { image_key: imageKey },
				});
				continue;
			}

			const uploadResult = (await this.client.im.v1.file.create({
				data: {
					file_type: resolveFeishuFileType(attachment.name),
					file_name: attachment.name,
					file: Buffer.from(attachmentBytes),
				},
			})) as FeishuFileUploadResponse | null;
			const fileKey = uploadResult?.file_key;
			if (!fileKey) {
				throw new Error(
					`Feishu file upload failed for ${attachment.path}`
				);
			}
			await sendPayload({
				msgType: FEISHU_FILE_MESSAGE_TYPE,
				content: {
					file_key: fileKey,
				},
			});
		}
	}

	private async handleEvent(event: FeishuMessageEvent): Promise<void> {
		const routeId = event.message.chat_id;
		if (!this.callbacks.shouldProcess(routeId)) {
			log.debug("feishu.message.no_route", { routeId });
			return;
		}

		const eventId = event.event_id ?? event.message.message_id;
		const dedupKey = createIdempotencyKey(this.id, routeId, eventId);
		if (this.dedup.has(dedupKey)) {
			log.debug("feishu.message.duplicate_skipped", {
				routeId,
				eventId,
			});
			return;
		}
		this.dedup.add(dedupKey);

		const parsedContent = parseMessageContent(event);
		const downloadedAttachments: EndpointAttachment[] = [];
		if (parsedContent.attachment) {
			const workspace = this.callbacks.resolveWorkspace(routeId);
			const downloaded = await this.downloadAttachment(
				event.message.message_id,
				parsedContent.attachment.resourceType,
				parsedContent.attachment.resourceKey
			);
			const fallbackName =
				parsedContent.attachment.fileName ??
				(parsedContent.attachment.resourceType === "image"
					? DEFAULT_IMAGE_FILE_NAME
					: DEFAULT_FILE_NAME);
			const saved = saveInboundAttachment({
				data: downloaded.data,
				fileName: downloaded.fileName ?? fallbackName,
				filePath: downloaded.filePath,
				contentType: downloaded.contentType,
				workspace,
				prefix: `${eventId}-1-`,
			});
			downloadedAttachments.push(saved);
		}

		if (!parsedContent.text && downloadedAttachments.length === 0) {
			return;
		}

		const messageId = event.message.message_id;
		const inboundCtx: EndpointInboundContext = {
			endpointId: this.id,
			instanceId: this.instanceId,
			routeId,
			messageId,
			text: parsedContent.text,
			attachments: downloadedAttachments,
			metadata: buildMessageMetadata(event, parsedContent),
			replyToMessageId: event.message.parent_id,
			sendTyping: async () => {
				throw new Error("Feishu typing indicator is not supported.");
			},
		};

		try {
			await this.messageHandler(inboundCtx);
			this.callbacks.onSuccess(
				routeId,
				eventId,
				messageId,
				parsedContent.text,
				downloadedAttachments
			);
		} catch (error: unknown) {
			this.dedup.delete(dedupKey);
			this.callbacks.onError(routeId, eventId, messageId, error);
			throw error;
		}
	}

	private async replyWithError(
		messageId: string,
		error: unknown
	): Promise<void> {
		const errorText = formatUserFacingErrorMessage(error);
		try {
			await this.client.im.v1.message.reply({
				path: {
					message_id: messageId,
				},
				data: {
					content: JSON.stringify({ text: errorText }),
					msg_type: FEISHU_TEXT_MESSAGE_TYPE,
					uuid: randomUUID(),
				},
			});
		} catch (replyError: unknown) {
			log.error("feishu.message.error_reply_failed", {
				messageId,
				err: normalizeUnknownError(replyError),
			});
		}
	}

	private async downloadAttachment(
		messageId: string,
		resourceType: "image" | "file",
		resourceKey: string
	): Promise<{
		data: Uint8Array;
		fileName?: string;
		filePath: string;
		contentType?: string;
	}> {
		const response = (await this.client.im.v1.messageResource.get({
			params: {
				type: resourceType,
			},
			path: {
				message_id: messageId,
				file_key: resourceKey,
			},
		})) as FeishuDownloadResponse;
		const data = await readStreamFully(response.getReadableStream());
		const fileName = parseContentDispositionFileName(response.headers);
		const contentType = resolveContentType(response.headers);
		return {
			data,
			fileName,
			filePath:
				fileName ??
				`${basename(resourceKey)}${resourceType === "image" ? ".png" : ""}`,
			contentType,
		};
	}
}
