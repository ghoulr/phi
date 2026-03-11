import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "bun:test";

import type { Message } from "@grammyjs/types";

import {
	resetPhiLoggerForTest,
	setPhiLoggerSettingsForTest,
} from "@phi/core/logger";
import type { PhiMessage } from "@phi/messaging/types";
import type { ChatHandler } from "@phi/services/chat-handler";
import {
	ServiceRoutes,
	type ChatHandlerInteractiveInput,
} from "@phi/services/routes";
import {
	buildTelegramMessageMetadata,
	startTelegramPollingBot,
	type TelegramPollingBot,
	type TelegramRouteTarget,
	type TelegramTextMessageContext,
} from "@phi/services/telegram";

class FakeTelegramBot implements TelegramPollingBot {
	private textMessageHandler?: (
		context: TelegramTextMessageContext
	) => Promise<void>;
	private errorHandler?: (error: unknown) => void;

	public startCalls = 0;
	public stopCalls = 0;
	public sentTexts: Array<{
		chatId: string;
		text: string;
		replyToMessageId?: string;
	}> = [];
	public sentPhotos: Array<{
		chatId: string;
		filePath: string;
		fileName: string;
		caption?: string;
		replyToMessageId?: string;
	}> = [];
	public sentDocuments: Array<{
		chatId: string;
		filePath: string;
		fileName: string;
		caption?: string;
		replyToMessageId?: string;
	}> = [];
	public downloadedFiles = new Map<
		string,
		{ data: Uint8Array; filePath: string; contentType?: string }
	>();

	public constructor(
		private readonly updates: TelegramTextMessageContext[]
	) {}

	public onTextMessage(
		handler: (context: TelegramTextMessageContext) => Promise<void>
	): void {
		this.textMessageHandler = handler;
	}

	public onError(handler: (error: unknown) => void): void {
		this.errorHandler = handler;
	}

	public async sendText(
		chatId: string,
		text: string,
		replyToMessageId?: string
	): Promise<unknown> {
		this.sentTexts.push({ chatId, text, replyToMessageId });
		return { ok: true };
	}

	public async sendPhoto(
		chatId: string,
		filePath: string,
		fileName: string,
		caption?: string,
		replyToMessageId?: string
	): Promise<unknown> {
		this.sentPhotos.push({
			chatId,
			filePath,
			fileName,
			caption,
			replyToMessageId,
		});
		return { ok: true };
	}

	public async sendDocument(
		chatId: string,
		filePath: string,
		fileName: string,
		caption?: string,
		replyToMessageId?: string
	): Promise<unknown> {
		this.sentDocuments.push({
			chatId,
			filePath,
			fileName,
			caption,
			replyToMessageId,
		});
		return { ok: true };
	}

	public async downloadFile(fileId: string): Promise<{
		data: Uint8Array;
		filePath: string;
		contentType?: string;
	}> {
		const file = this.downloadedFiles.get(fileId);
		if (!file) {
			throw new Error(`Missing fake telegram file: ${fileId}`);
		}
		return file;
	}

	public async start(): Promise<void> {
		this.startCalls += 1;
		if (!this.textMessageHandler) {
			throw new Error("Text message handler was not registered.");
		}
		for (const update of this.updates) {
			await this.textMessageHandler(update);
		}
	}

	public async stop(): Promise<void> {
		this.stopCalls += 1;
	}

	public emitError(error: unknown): void {
		this.errorHandler?.(error);
	}
}

let nextUpdateId = 1;
const createdWorkspaces: string[] = [];
let _currentLogOutput = "";
let logCaptureConfigured = false;

function ensureLogCapture(): void {
	if (logCaptureConfigured) {
		return;
	}
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			_currentLogOutput += chunk.toString();
			callback();
		},
	});
	setPhiLoggerSettingsForTest({
		level: "debug",
		format: "json",
		stream,
	});
	logCaptureConfigured = true;
}

function createRouteTarget(chatId: string): TelegramRouteTarget {
	ensureLogCapture();
	const workspace = mkdtempSync(join(tmpdir(), "phi-telegram-workspace-"));
	createdWorkspaces.push(workspace);
	return { chatId, workspace };
}

function createChatHandler(overrides: Partial<ChatHandler> = {}): ChatHandler {
	return {
		async submitInteractive(): Promise<void> {},
		async submitCron(): Promise<PhiMessage[]> {
			return [];
		},
		invalidate(): void {},
		dispose(): void {},
		...overrides,
	};
}

function createContext(
	overrides?: Partial<TelegramTextMessageContext>
): TelegramTextMessageContext {
	const base: TelegramTextMessageContext = {
		updateId: nextUpdateId++,
		chat: { id: 42 },
		message: {
			id: 10,
			text: "hello",
			attachments: [],
			metadata: {
				current_message: {
					message_id: 10,
				},
			},
		},
		sendTyping: async () => ({ ok: true }),
	};
	const mergedMessage = { ...base.message, ...overrides?.message };
	if (!mergedMessage.metadata) {
		mergedMessage.metadata = {
			current_message: {
				message_id: mergedMessage.id,
			},
		};
	}
	return {
		...base,
		...overrides,
		chat: { ...base.chat, ...overrides?.chat },
		message: mergedMessage,
	};
}

afterEach(() => {
	resetPhiLoggerForTest();
	_currentLogOutput = "";
	logCaptureConfigured = false;
	for (const workspace of createdWorkspaces) {
		rmSync(workspace, { recursive: true, force: true });
	}
	createdWorkspaces.length = 0;
});

describe("telegram service", () => {
	it("builds message metadata from reply_to_message", () => {
		const metadata = buildTelegramMessageMetadata({
			message_id: 10,
			date: 0,
			chat: { id: 42, type: "private" },
			from: {
				id: 200,
				is_bot: false,
				first_name: "Bob",
			},
			reply_to_message: {
				message_id: 9,
				date: 0,
				chat: { id: 42, type: "private" },
				from: {
					id: 100,
					is_bot: false,
					first_name: "Alice",
				},
				text: "original body",
			},
			quote: {
				text: "quoted fragment",
				position: 0,
			},
		} as Message);

		expect(metadata).toEqual({
			current_message: {
				message_id: 10,
				from: {
					id: 200,
					first_name: "Bob",
				},
				chat: {
					id: 42,
					type: "private",
				},
			},
			reply_to_message: {
				message_id: 9,
				from: {
					id: 100,
					first_name: "Alice",
				},
				chat: {
					id: 42,
					type: "private",
				},
				text: "original body",
			},
			quote: {
				text: "quoted fragment",
				position: 0,
			},
		});
	});

	it("builds message metadata from external_reply and quote", () => {
		const metadata = buildTelegramMessageMetadata({
			message_id: 10,
			date: 0,
			chat: { id: 42, type: "private" },
			external_reply: {
				origin: {
					type: "user",
					date: 0,
					sender_user: {
						id: 100,
						is_bot: false,
						first_name: "Alice",
					},
				},
				message_id: 8,
				document: {
					file_id: "file-1",
					file_unique_id: "uniq-1",
					file_name: "report.pdf",
				},
			},
			quote: {
				text: "quoted fragment",
				position: 0,
			},
		} as Message);

		expect(metadata).toEqual({
			current_message: {
				message_id: 10,
				chat: {
					id: 42,
					type: "private",
				},
			},
			external_reply: {
				message_id: 8,
				origin: {
					type: "user",
					date: 0,
					sender_user: {
						id: 100,
						first_name: "Alice",
					},
				},
				document: {
					file_name: "report.pdf",
				},
			},
			quote: {
				text: "quoted fragment",
				position: 0,
			},
		});
	});

	it("builds message metadata from forward_origin", () => {
		const metadata = buildTelegramMessageMetadata({
			message_id: 10,
			date: 0,
			chat: { id: 42, type: "private" },
			forward_origin: {
				type: "channel",
				date: 0,
				message_id: 88,
				chat: {
					id: 7,
					type: "channel",
					title: "Market Feed",
				},
			},
			text: "forwarded body",
		} as Message);

		expect(metadata).toEqual({
			current_message: {
				message_id: 10,
				chat: {
					id: 42,
					type: "private",
				},
			},
			forward_origin: {
				type: "channel",
				date: 0,
				message_id: 88,
				chat: {
					id: 7,
					type: "channel",
					title: "Market Feed",
				},
			},
		});
	});

	it("routes telegram message to the configured chat handler", async () => {
		const bot = new FakeTelegramBot([createContext()]);
		const routes = new ServiceRoutes();
		const submissions: ChatHandlerInteractiveInput[] = [];
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(input): Promise<void> {
					submissions.push(input);
				},
			})
		);

		const running = await startTelegramPollingBot(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		expect(submissions).toEqual([
			{
				text: "hello",
				attachments: [],
				metadata: {
					current_message: {
						message_id: 10,
					},
				},
				sendTyping: expect.any(Function),
			},
		]);
		expect(bot.startCalls).toBe(1);
	});

	it("downloads document attachments and passes local paths to the chat handler", async () => {
		const bot = new FakeTelegramBot([
			createContext({
				message: {
					id: 10,
					text: "check this",
					attachments: [
						{
							fileId: "doc-1",
							fileName: "report.pdf",
							mimeType: "application/pdf",
						},
					],
				},
			}),
		]);
		bot.downloadedFiles.set("doc-1", {
			data: new Uint8Array([1, 2, 3]),
			filePath: "documents/report.pdf",
			contentType: "application/pdf",
		});
		const routes = new ServiceRoutes();
		const submissions: ChatHandlerInteractiveInput[] = [];
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(input): Promise<void> {
					submissions.push(input);
				},
			})
		);

		const running = await startTelegramPollingBot(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		const input = submissions[0];
		expect(input?.text).toBe("check this");
		expect(input?.attachments).toHaveLength(1);
		expect(input?.attachments[0]?.path).toContain(".phi/inbox/");
		expect(input?.attachments[0]?.name).toContain("report.pdf");
		expect(input?.attachments[0]?.mimeType).toBe("application/pdf");
	});

	it("downloads photo attachments and passes them as generic attachments", async () => {
		const bot = new FakeTelegramBot([
			createContext({
				message: {
					id: 10,
					text: "see image",
					attachments: [
						{
							fileId: "photo-1",
							mimeType: "image/jpeg",
						},
					],
				},
			}),
		]);
		bot.downloadedFiles.set("photo-1", {
			data: new Uint8Array([1, 2, 3]),
			filePath: "photos/file_1.jpg",
			contentType: "image/jpeg",
		});
		const routes = new ServiceRoutes();
		const submissions: ChatHandlerInteractiveInput[] = [];
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(input): Promise<void> {
					submissions.push(input);
				},
			})
		);

		const running = await startTelegramPollingBot(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		const input = submissions[0];
		expect(input?.text).toBe("see image");
		expect(input?.attachments).toEqual([
			{
				path: expect.stringContaining(".phi/inbox/"),
				name: expect.stringContaining(".jpg"),
				mimeType: "image/jpeg",
			},
		]);
		expect(input?.metadata).toEqual({
			current_message: {
				message_id: 10,
			},
		});
	});

	it("passes attachment-only photos without requiring text", async () => {
		const bot = new FakeTelegramBot([
			createContext({
				message: {
					id: 10,
					text: undefined,
					attachments: [
						{
							fileId: "photo-1",
							mimeType: "image/jpeg",
						},
					],
				},
			}),
		]);
		bot.downloadedFiles.set("photo-1", {
			data: new Uint8Array([1, 2, 3]),
			filePath: "photos/file_1.jpg",
			contentType: "image/jpeg",
		});
		const routes = new ServiceRoutes();
		const submissions: ChatHandlerInteractiveInput[] = [];
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(input): Promise<void> {
					submissions.push(input);
				},
			})
		);

		const running = await startTelegramPollingBot(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		const input = submissions[0];
		expect(input?.text).toBeUndefined();
		expect(input?.attachments).toEqual([
			{
				path: expect.stringContaining(".phi/inbox/"),
				name: expect.stringContaining(".jpg"),
				mimeType: "image/jpeg",
			},
		]);
	});

	it("delivers outbound messages through registered telegram routes", async () => {
		const bot = new FakeTelegramBot([createContext()]);
		const routes = new ServiceRoutes();
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(): Promise<void> {
					await routes.deliverOutbound("user-alice", {
						text: "assistant reply",
						attachments: [],
					});
				},
			})
		);

		const running = await startTelegramPollingBot(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		expect(bot.sentTexts).toEqual([
			{
				chatId: "42",
				text: "assistant reply",
				replyToMessageId: undefined,
			},
		]);
	});

	it("replies request error text for unknown chat route", async () => {
		const bot = new FakeTelegramBot([
			createContext({
				chat: { id: 999 },
				message: { id: 10, text: "unknown chat", attachments: [] },
			}),
		]);

		const running = await startTelegramPollingBot(
			new ServiceRoutes(),
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		expect(bot.sentTexts).toEqual([
			{
				chatId: "999",
				text: "No agent configured for telegram chat id: 999",
				replyToMessageId: undefined,
			},
		]);
	});

	it("replies request error text for invalid payload", async () => {
		const bot = new FakeTelegramBot([
			createContext({
				message: { id: 10, text: "a\u0000b", attachments: [] },
			}),
		]);
		const routes = new ServiceRoutes();
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(input): Promise<void> {
					if (input.text?.includes("\u0000")) {
						throw new Error("message must not contain null bytes");
					}
				},
			})
		);

		const running = await startTelegramPollingBot(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		expect(bot.sentTexts).toEqual([
			{
				chatId: "42",
				text: "message must not contain null bytes",
				replyToMessageId: "10",
			},
		]);
	});

	it("replies request error text for chat handler failure", async () => {
		const bot = new FakeTelegramBot([createContext()]);
		const routes = new ServiceRoutes();
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(): Promise<void> {
					throw new Error("runtime unavailable");
				},
			})
		);

		const running = await startTelegramPollingBot(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		expect(bot.sentTexts).toEqual([
			{
				chatId: "42",
				text: "runtime unavailable",
				replyToMessageId: "10",
			},
		]);
	});

	it("sanitizes request error text before replying", async () => {
		const bot = new FakeTelegramBot([createContext()]);
		const routes = new ServiceRoutes();
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(): Promise<void> {
					throw new Error("a\u0001b\u007fc");
				},
			})
		);

		const running = await startTelegramPollingBot(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		expect(bot.sentTexts).toEqual([
			{ chatId: "42", text: "abc", replyToMessageId: "10" },
		]);
	});

	it("sanitizes and chunks long outbound replies", async () => {
		const bot = new FakeTelegramBot([createContext()]);
		const longText = `${"a".repeat(4200)}\u0001${"b".repeat(120)}`;
		const routes = new ServiceRoutes();
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(): Promise<void> {
					await routes.deliverOutbound("user-alice", {
						text: longText,
						attachments: [],
					});
				},
			})
		);

		const running = await startTelegramPollingBot(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		expect(bot.sentTexts.length).toBeGreaterThan(1);
		expect(bot.sentTexts.every((entry) => entry.text.length <= 4096)).toBe(
			true
		);
		expect(bot.sentTexts.map((entry) => entry.text).join("")).toBe(
			`${"a".repeat(4200)}${"b".repeat(120)}`
		);
	});

	it("skips duplicate updates after a successful submit", async () => {
		const bot = new FakeTelegramBot([
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello", attachments: [] },
			}),
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello", attachments: [] },
			}),
		]);
		const routes = new ServiceRoutes();
		let callCount = 0;
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(): Promise<void> {
					callCount += 1;
				},
			})
		);

		const running = await startTelegramPollingBot(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		expect(callCount).toBe(1);
	});

	it("allows retrying the same update after a failed attempt", async () => {
		const bot = new FakeTelegramBot([
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello", attachments: [] },
			}),
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello", attachments: [] },
			}),
		]);
		const routes = new ServiceRoutes();
		let attempt = 0;
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(): Promise<void> {
					attempt += 1;
					if (attempt === 1) {
						throw new Error("runtime unavailable");
					}
					await routes.deliverOutbound("user-alice", {
						text: "assistant reply",
						attachments: [],
					});
				},
			})
		);

		const running = await startTelegramPollingBot(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => bot }
		);
		await running.done;

		expect(bot.sentTexts).toEqual([
			{
				chatId: "42",
				text: "runtime unavailable",
				replyToMessageId: "1",
			},
			{
				chatId: "42",
				text: "assistant reply",
				replyToMessageId: undefined,
			},
		]);
	});
});
