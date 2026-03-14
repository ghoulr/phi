import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "bun:test";

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
	startTelegramEndpoint,
	type TelegramRouteTarget,
} from "@phi/services/telegram";
import type {
	TelegramBotFactory,
	TelegramBotLike,
} from "@phi/services/endpoints";

interface FakeTelegramUpdate {
	routeId: string;
	messageId: number;
	text?: string;
	attachments?: Array<{
		fileId: string;
		fileName?: string;
		mimeType?: string;
	}>;
}

type FakeContext = Record<string, unknown>;

class FakeTelegramBot implements TelegramBotLike {
	private messageHandler?: (ctx: FakeContext) => Promise<void>;

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

	public constructor(private readonly updates: FakeTelegramUpdate[]) {}

	public get api() {
		return {
			sendMessage: async (
				chatId: string,
				text: string,
				params?: Record<string, unknown>
			) => {
				this.sentTexts.push({
					chatId,
					text,
					replyToMessageId: params?.reply_parameters
						? String(
								(
									params.reply_parameters as {
										message_id: number;
									}
								).message_id
							)
						: undefined,
				});
				return { ok: true };
			},
			sendPhoto: async (
				chatId: string,
				_photo: unknown,
				params?: Record<string, unknown>
			) => {
				this.sentPhotos.push({
					chatId,
					filePath: "photo",
					fileName: "photo.jpg",
					caption: params?.caption as string,
					replyToMessageId: params?.reply_parameters
						? String(
								(
									params.reply_parameters as {
										message_id: number;
									}
								).message_id
							)
						: undefined,
				});
				return { ok: true };
			},
			sendDocument: async (
				chatId: string,
				_document: unknown,
				params?: Record<string, unknown>
			) => {
				this.sentDocuments.push({
					chatId,
					filePath: "document",
					fileName: "document.pdf",
					caption: params?.caption as string,
					replyToMessageId: params?.reply_parameters
						? String(
								(
									params.reply_parameters as {
										message_id: number;
									}
								).message_id
							)
						: undefined,
				});
				return { ok: true };
			},
			sendChatAction: async () => ({ ok: true }),
			getFile: async (fileId: string) => {
				const file = this.downloadedFiles.get(fileId);
				if (!file) {
					throw new Error(`Missing fake telegram file: ${fileId}`);
				}
				return { file_path: file.filePath };
			},
			token: "fake-token",
		};
	}

	public on(_event: unknown, handler: unknown): void {
		this.messageHandler = handler as (ctx: FakeContext) => Promise<void>;
	}

	public catch(_handler: unknown): void {}

	public async start(_params?: Record<string, unknown>): Promise<void> {
		this.startCalls += 1;
		if (!this.messageHandler) {
			throw new Error("Message handler was not registered.");
		}
		for (const update of this.updates) {
			const ctx = this.buildContext(update);
			await this.messageHandler(ctx);
		}
	}

	public async stop(): Promise<void> {
		this.stopCalls += 1;
	}

	private buildContext(update: FakeTelegramUpdate) {
		const attachments = update.attachments ?? [];
		const imageAttachment = attachments.find(
			(a) => a.mimeType === "image/jpeg"
		);
		const fileAttachment = attachments.find(
			(a) => a.mimeType !== "image/jpeg"
		);

		return {
			message: {
				message_id: update.messageId,
				text: update.text,
				chat: { id: Number(update.routeId) },
				photo: imageAttachment
					? [{ file_id: imageAttachment.fileId }]
					: undefined,
				document: fileAttachment
					? {
							file_id: fileAttachment.fileId,
							file_name: fileAttachment.fileName,
							mime_type: fileAttachment.mimeType,
						}
					: undefined,
			},
			chat: { id: Number(update.routeId) },
			update: { update_id: Math.floor(Math.random() * 100000) },
			api: this.api,
		};
	}
}

let _currentLogOutput = "";
let logCaptureConfigured = false;
const createdWorkspaces: string[] = [];

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
		async validateReload(): Promise<string[]> {
			return [];
		},
		invalidate(): void {},
		dispose(): void {},
		...overrides,
	};
}

function createBotFactory(bot: FakeTelegramBot): TelegramBotFactory {
	return () => bot as unknown as TelegramBotLike;
}

function readCapturedLogs(): Array<Record<string, unknown>> {
	return _currentLogOutput
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
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
	it("routes telegram message to the configured chat handler", async () => {
		const bot = new FakeTelegramBot([
			{ routeId: "42", messageId: 10, text: "hello" },
		]);
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

		const running = await startTelegramEndpoint(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			createBotFactory(bot)
		);
		await running.done;

		expect(submissions.length).toBe(1);
		expect(submissions[0]?.text).toBe("hello");
		expect(bot.startCalls).toBe(1);
	});

	it("delivers outbound messages through registered telegram routes", async () => {
		const bot = new FakeTelegramBot([
			{ routeId: "42", messageId: 10, text: "trigger" },
		]);
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

		const running = await startTelegramEndpoint(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			createBotFactory(bot)
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

	it("writes outbound assistant audit logs for delivered telegram replies", async () => {
		const bot = new FakeTelegramBot([
			{ routeId: "42", messageId: 10, text: "trigger" },
		]);
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

		const running = await startTelegramEndpoint(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			createBotFactory(bot)
		);
		await running.done;

		const logs = readCapturedLogs();
		expect(
			logs.some(
				(record) =>
					record.event === "telegram.message" &&
					record.category === "audit" &&
					record.direction === "outbound" &&
					record.source === "assistant" &&
					record.chatId === "user-alice" &&
					record.telegramChatId === "42" &&
					record.text === "assistant reply"
			)
		).toBe(true);
	});

	it("sanitizes and chunks long outbound replies", async () => {
		const longText = `${"a".repeat(4200)}\u0001${"b".repeat(120)}`;
		const bot = new FakeTelegramBot([
			{ routeId: "42", messageId: 10, text: "trigger" },
		]);
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

		const running = await startTelegramEndpoint(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			createBotFactory(bot)
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

	it("silently ignores messages from unconfigured chats", async () => {
		const bot = new FakeTelegramBot([
			{ routeId: "999", messageId: 10, text: "unknown chat" },
		]);

		const running = await startTelegramEndpoint(
			new ServiceRoutes(),
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			createBotFactory(bot)
		);
		await running.done;

		expect(bot.sentTexts).toEqual([]);
	});

	it("replies error text for chat handler failure", async () => {
		const bot = new FakeTelegramBot([
			{ routeId: "42", messageId: 10, text: "hello" },
		]);
		const routes = new ServiceRoutes();
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(): Promise<void> {
					throw new Error("runtime unavailable");
				},
			})
		);

		const running = await startTelegramEndpoint(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			createBotFactory(bot)
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

	it("uses non-sensitive instance id", async () => {
		const { TelegramProvider } = await import("@phi/services/endpoints");

		const provider = TelegramProvider.create({
			token: "super-secret-bot-token-12345",
			callbacks: {
				shouldProcess: () => true,
				resolveWorkspace: () => "/tmp",
				onSuccess() {},
				onError() {},
			},
			onMessage: async () => {},
		});

		expect(provider.instanceId).not.toContain("secret");
		expect(provider.instanceId).not.toContain("12345");
		expect(provider.instanceId).toMatch(/^tg-/);
	});

	it("sends long text with attachment without duplicate reply params", async () => {
		const workspace = mkdtempSync(join(tmpdir(), "phi-edge-test-"));
		createdWorkspaces.push(workspace);
		const filePath = join(workspace, "test.pdf");
		writeFileSync(filePath, "fake pdf content");

		const bot = new FakeTelegramBot([
			{ routeId: "42", messageId: 10, text: "trigger" },
		]);
		const routes = new ServiceRoutes();
		routes.registerChatHandler(
			"user-alice",
			createChatHandler({
				async submitInteractive(): Promise<void> {
					await routes.deliverOutbound("user-alice", {
						text: "a".repeat(2000),
						attachments: [{ path: filePath, name: "test.pdf" }],
					});
				},
			})
		);

		const running = await startTelegramEndpoint(
			routes,
			{
				token: "test-token",
				chatRoutes: {
					"42": {
						chatId: "user-alice",
						workspace,
					},
				},
			},
			createBotFactory(bot)
		);
		await running.done;

		expect(bot.sentTexts.length).toBeGreaterThan(0);
		expect(bot.sentDocuments.length).toBe(1);
		expect(bot.sentDocuments[0]?.replyToMessageId).toBeUndefined();
	});
});
