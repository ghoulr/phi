import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "bun:test";

import type {
	AgentSession,
	AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { Message } from "@grammyjs/types";

import { resetChatLogStateForTest } from "@phi/core/chat-log";
import {
	resetPhiLoggerForTest,
	setPhiLoggerSettingsForTest,
} from "@phi/core/logger";
import type { ChatSessionRuntime } from "@phi/core/runtime";
import {
	registerPhiMessagingSessionState,
	PhiMessagingSessionState,
} from "@phi/messaging/session-state";
import {
	buildTelegramSystemReminderMetadata,
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
		private readonly updates: TelegramTextMessageContext[],
		private readonly concurrentDispatch: boolean = false
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

		if (this.concurrentDispatch) {
			await Promise.all(
				this.updates.map(async (update) => {
					await this.textMessageHandler?.(update);
				})
			);
			return;
		}

		for (const update of this.updates) {
			await this.textMessageHandler(update);
		}
	}

	public async stop(): Promise<void> {
		this.stopCalls += 1;
	}

	public emitError(error: unknown): void {
		if (!this.errorHandler) {
			throw new Error("Error handler was not registered.");
		}
		this.errorHandler(error);
	}
}

type FakeRuntimeState = {
	calls: Array<{
		chatId: string;
		prompt: string | (TextContent | ImageContent)[];
	}>;
	disposeCalls: string[];
};

function createFakeRuntime(responseText: string): {
	runtime: ChatSessionRuntime<AgentSession>;
	state: FakeRuntimeState;
} {
	const state: FakeRuntimeState = {
		calls: [],
		disposeCalls: [],
	};

	const runtime: ChatSessionRuntime<AgentSession> = {
		async getOrCreateSession(chatId: string) {
			const session = {
				subscribe() {
					return () => {};
				},
				async sendUserMessage(
					content: string | (TextContent | ImageContent)[]
				): Promise<void> {
					state.calls.push({
						chatId,
						prompt: content,
					});
				},
				getLastAssistantText(): string | undefined {
					return responseText;
				},
				dispose(): void {},
			} as unknown as AgentSession;
			registerPhiMessagingSessionState(
				session,
				new PhiMessagingSessionState()
			);
			return session;
		},
		disposeSession(chatId: string): boolean {
			state.disposeCalls.push(chatId);
			return true;
		},
	};

	return { runtime, state };
}

let nextUpdateId = 1;
const createdWorkspaces: string[] = [];
let currentLogOutput = "";
let logCaptureConfigured = false;

function ensureLogCapture(): void {
	if (logCaptureConfigured) {
		return;
	}
	const stream = new Writable({
		write(chunk, _encoding, callback) {
			currentLogOutput += chunk.toString();
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

function readCapturedLogs(): string {
	return currentLogOutput;
}

function createRouteTarget(chatId: string): TelegramRouteTarget {
	ensureLogCapture();
	const workspace = mkdtempSync(join(tmpdir(), "phi-telegram-workspace-"));
	createdWorkspaces.push(workspace);
	return { chatId, workspace };
}

afterEach(() => {
	resetChatLogStateForTest();
	resetPhiLoggerForTest();
	currentLogOutput = "";
	logCaptureConfigured = false;
	for (const workspace of createdWorkspaces) {
		rmSync(workspace, { recursive: true, force: true });
	}
	createdWorkspaces.length = 0;
});

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
			systemReminderMetadata: {
				current_message: {
					message_id: 10,
				},
			},
		},
		reply: async () => ({ ok: true }),
		sendTyping: async () => ({ ok: true }),
	};
	const mergedMessage = { ...base.message, ...overrides?.message };
	if (!mergedMessage.systemReminderMetadata) {
		mergedMessage.systemReminderMetadata = {
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

describe("telegram service", () => {
	it("builds reminder metadata from reply_to_message", () => {
		const metadata = buildTelegramSystemReminderMetadata({
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

	it("builds reminder metadata from external_reply and quote", () => {
		const metadata = buildTelegramSystemReminderMetadata({
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

	it("builds reminder metadata from forward_origin", () => {
		const metadata = buildTelegramSystemReminderMetadata({
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

	it("routes telegram message to configured chat", async () => {
		const fakeBot = new FakeTelegramBot([
			createContext({
				message: {
					id: 10,
					text: "hello from telegram",
					attachments: [],
				},
			}),
		]);
		const { runtime, state } = createFakeRuntime("assistant reply");

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => fakeBot }
		);
		await running.done;

		expect(state.calls[0]?.chatId).toBe("user-alice");
		expect(Array.isArray(state.calls[0]?.prompt)).toBe(true);
		expect(state.calls[0]?.prompt?.[0]).toEqual({
			type: "text",
			text: "hello from telegram",
		});
		expect(state.calls[0]?.prompt?.[1]).toEqual({
			type: "text",
			text: expect.stringContaining("<system-reminder>"),
		});
		expect(fakeBot.sentTexts).toEqual([
			{
				chatId: "42",
				text: "assistant reply",
				replyToMessageId: undefined,
			},
		]);
		expect(fakeBot.startCalls).toBe(1);
		expect(state.disposeCalls).toEqual(["user-alice"]);
	});

	it("downloads document attachments and passes local paths to the agent", async () => {
		const fakeBot = new FakeTelegramBot([
			createContext({
				message: {
					id: 10,
					text: "check this",
					attachments: [
						{
							fileId: "doc-1",
							fileName: "report.pdf",
							mimeType: "application/pdf",
							kind: "file",
						},
					],
				},
			}),
		]);
		fakeBot.downloadedFiles.set("doc-1", {
			data: new Uint8Array([1, 2, 3]),
			filePath: "documents/report.pdf",
			contentType: "application/pdf",
		});
		const route = createRouteTarget("user-alice");
		const { runtime, state } = createFakeRuntime("assistant reply");

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": route,
				},
			},
			{ createBot: () => fakeBot }
		);
		await running.done;

		const prompt = state.calls[0]?.prompt;
		expect(Array.isArray(prompt)).toBe(true);
		expect(prompt?.[0]).toEqual({
			type: "text",
			text: expect.stringContaining("check this"),
		});
		expect(
			typeof prompt?.[0] === "object" &&
				prompt[0] !== null &&
				"text" in prompt[0]
				? prompt[0].text
				: ""
		).toContain("User sent attachments:");
		expect(
			typeof prompt?.[0] === "object" &&
				prompt[0] !== null &&
				"text" in prompt[0]
				? prompt[0].text
				: ""
		).toContain(".phi/inbox/");
		expect(
			typeof prompt?.[0] === "object" &&
				prompt[0] !== null &&
				"text" in prompt[0]
				? prompt[0].text
				: ""
		).toContain("report.pdf");
		expect(prompt?.at(-1)).toEqual({
			type: "text",
			text: expect.stringContaining("<system-reminder>"),
		});
	});

	it("downloads photo attachments and passes them as images to the agent", async () => {
		const fakeBot = new FakeTelegramBot([
			createContext({
				message: {
					id: 10,
					text: "see image",
					attachments: [
						{
							fileId: "photo-1",
							mimeType: "image/jpeg",
							kind: "image",
						},
					],
				},
			}),
		]);
		fakeBot.downloadedFiles.set("photo-1", {
			data: new Uint8Array([1, 2, 3]),
			filePath: "photos/file_1.jpg",
			contentType: "image/jpeg",
		});
		const route = createRouteTarget("user-alice");
		const { runtime, state } = createFakeRuntime("assistant reply");

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": route,
				},
			},
			{ createBot: () => fakeBot }
		);
		await running.done;

		const prompt = state.calls[0]?.prompt;
		expect(Array.isArray(prompt)).toBe(true);
		expect(prompt?.[0]).toEqual({
			type: "text",
			text: expect.stringContaining("User sent 1 image attachment(s)."),
		});
		expect(
			typeof prompt?.[0] === "object" &&
				prompt[0] !== null &&
				"text" in prompt[0]
				? prompt[0].text
				: ""
		).toContain(".phi/inbox/");
		expect(prompt?.[1]).toEqual({
			type: "image",
			mimeType: "image/jpeg",
			data: "AQID",
		});
		expect(prompt?.at(-1)).toEqual({
			type: "text",
			text: expect.stringContaining("<system-reminder>"),
		});
	});

	it("passes attachment-only photos to the agent without requiring text", async () => {
		const fakeBot = new FakeTelegramBot([
			createContext({
				message: {
					id: 10,
					text: undefined,
					attachments: [
						{
							fileId: "photo-1",
							mimeType: "image/jpeg",
							kind: "image",
						},
					],
				},
			}),
		]);
		fakeBot.downloadedFiles.set("photo-1", {
			data: new Uint8Array([1, 2, 3]),
			filePath: "photos/file_1.jpg",
			contentType: "image/jpeg",
		});
		const route = createRouteTarget("user-alice");
		const { runtime, state } = createFakeRuntime("assistant reply");

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": route,
				},
			},
			{ createBot: () => fakeBot }
		);
		await running.done;

		const prompt = state.calls[0]?.prompt;
		expect(Array.isArray(prompt)).toBe(true);
		expect(prompt?.[0]).toEqual({
			type: "text",
			text: expect.stringContaining("User sent 1 image attachment(s)."),
		});
		expect(
			typeof prompt?.[0] === "object" &&
				prompt[0] !== null &&
				"text" in prompt[0]
				? prompt[0].text
				: ""
		).toContain(".phi/inbox/");
		expect(prompt?.[1]).toEqual({
			type: "image",
			mimeType: "image/jpeg",
			data: "AQID",
		});
		expect(prompt?.at(-1)).toEqual({
			type: "text",
			text: expect.stringContaining("<system-reminder>"),
		});
	});

	it("serializes same-chat jobs when updates arrive concurrently", async () => {
		let releaseFirst: (() => void) | undefined;
		const order: string[] = [];
		const messagingState = new PhiMessagingSessionState();

		const session = {
			subscribe() {
				return () => {};
			},
			async sendUserMessage(
				content: string | (TextContent | ImageContent)[]
			): Promise<void> {
				const text =
					typeof content === "string"
						? content
						: content
								.filter(
									(part): part is TextContent =>
										part.type === "text"
								)
								.map((part) => part.text)
								.find((part) => part === "m1" || part === "m2");
				if (text === "m1") {
					order.push("start1");
					await new Promise<void>((resolve) => {
						releaseFirst = resolve;
					});
					order.push("end1");
					return;
				}
				order.push("start2");
				order.push("end2");
			},
			getLastAssistantText(): string | undefined {
				return "ok";
			},
			dispose(): void {},
		} as unknown as AgentSession;
		registerPhiMessagingSessionState(session, messagingState);

		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession() {
				return session;
			},
			disposeSession(): boolean {
				return true;
			},
		};

		const fakeBot = new FakeTelegramBot(
			[
				createContext({
					chat: { id: 7 },
					message: { id: 101, text: "m1", attachments: [] },
				}),
				createContext({
					chat: { id: 7 },
					message: { id: 102, text: "m2", attachments: [] },
				}),
			],
			true
		);

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"7": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => fakeBot }
		);

		for (
			let attempt = 0;
			attempt < 10 && order.length === 0;
			attempt += 1
		) {
			await Promise.resolve();
		}
		expect(order).toEqual(["start1"]);
		if (!releaseFirst) {
			throw new Error("First resolver was not assigned.");
		}
		releaseFirst();

		await running.done;
		expect(order).toEqual(["start1", "end1", "start2", "end2"]);
		expect(fakeBot.sentTexts.map((entry) => entry.text)).toEqual([
			"ok",
			"ok",
		]);
		expect(
			fakeBot.sentTexts.every(
				(entry) => entry.replyToMessageId === undefined
			)
		).toBe(true);
	});

	it("replies request error text for unknown chat route", async () => {
		const fakeBot = new FakeTelegramBot([
			createContext({
				chat: { id: 999 },
				message: { id: 10, text: "unknown chat", attachments: [] },
			}),
		]);
		const { runtime, state } = createFakeRuntime("unused");

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;
		expect(state.calls).toEqual([]);
		expect(fakeBot.sentTexts).toEqual([
			{
				chatId: "999",
				text: "No agent configured for telegram chat id: 999",
				replyToMessageId: undefined,
			},
		]);
	});

	it("replies request error text for invalid message payload", async () => {
		const fakeBot = new FakeTelegramBot([
			createContext({
				message: { id: 10, text: "a\u0000b", attachments: [] },
			}),
		]);
		const { runtime, state } = createFakeRuntime("unused");

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;
		expect(state.calls).toEqual([]);
		expect(fakeBot.sentTexts).toEqual([
			{
				chatId: "42",
				text: "message must not contain null bytes",
				replyToMessageId: "10",
			},
		]);
	});

	it("replies request error text for internal runtime failure", async () => {
		const route = createRouteTarget("user-alice");
		const fakeBot = new FakeTelegramBot([createContext()]);

		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession(): Promise<AgentSession> {
				throw new Error("runtime unavailable");
			},
			disposeSession(): boolean {
				return true;
			},
		};

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": route,
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;
		expect(fakeBot.sentTexts).toEqual([
			{
				chatId: "42",
				text: "runtime unavailable",
				replyToMessageId: "10",
			},
		]);

		const logsContent = readCapturedLogs();
		expect(logsContent.includes('"direction":"inbound"')).toBe(true);
		expect(logsContent.includes('"source":"error"')).toBe(true);
		expect(logsContent.includes('"text":"runtime unavailable"')).toBe(true);
	});

	it("sanitizes request error text before replying", async () => {
		const fakeBot = new FakeTelegramBot([createContext()]);

		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession(): Promise<AgentSession> {
				throw new Error("a\u0001b\u007fc");
			},
			disposeSession(): boolean {
				return true;
			},
		};

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;
		expect(fakeBot.sentTexts).toEqual([
			{ chatId: "42", text: "abc", replyToMessageId: "10" },
		]);
	});

	it("sanitizes and chunks long assistant replies", async () => {
		const fakeBot = new FakeTelegramBot([createContext()]);
		const longText = `${"a".repeat(4200)}\u0001${"b".repeat(120)}`;
		const { runtime } = createFakeRuntime(longText);

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;
		expect(fakeBot.sentTexts.length).toBeGreaterThan(1);
		expect(
			fakeBot.sentTexts.every((entry) => entry.text.length <= 4096)
		).toBe(true);
		expect(fakeBot.sentTexts.map((entry) => entry.text).join("")).toBe(
			`${"a".repeat(4200)}${"b".repeat(120)}`
		);
		expect(fakeBot.sentTexts[0]?.replyToMessageId).toBeUndefined();
	});

	it("skips duplicate updates after processed state in logs", async () => {
		const route = createRouteTarget("user-alice");
		const { runtime, state } = createFakeRuntime("assistant reply");
		const fakeBot = new FakeTelegramBot([
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello", attachments: [] },
			}),
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello", attachments: [] },
			}),
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello", attachments: [] },
			}),
		]);

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": route,
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;

		expect(state.calls).toHaveLength(1);
		expect(fakeBot.sentTexts.map((entry) => entry.text)).toEqual([
			"assistant reply",
		]);
		expect(fakeBot.sentTexts[0]?.replyToMessageId).toBeUndefined();

		const logsContent = readCapturedLogs();
		expect(logsContent.includes('"direction":"outbound"')).toBe(true);
		expect(logsContent.includes('"source":"assistant"')).toBe(true);
		const auditLines = logsContent
			.split("\n")
			.filter((line) => line.includes('"category":"audit"'));
		expect(auditLines).toHaveLength(2);
	});

	it("sends typing for assistant thoughts and text, not tool calls", async () => {
		let listener: ((event: AgentSessionEvent) => void) | undefined;
		let typingCalls = 0;

		const session = {
			subscribe(handler: (event: AgentSessionEvent) => void) {
				listener = handler;
				return () => {
					listener = undefined;
				};
			},
			async sendUserMessage(): Promise<void> {
				if (!listener) {
					throw new Error("Session listener was not registered.");
				}
				listener({
					type: "message_update",
					message: { role: "assistant" },
					assistantMessageEvent: { type: "thinking_delta" },
				} as unknown as AgentSessionEvent);
				listener({
					type: "message_update",
					message: { role: "assistant" },
					assistantMessageEvent: { type: "toolcall_start" },
				} as unknown as AgentSessionEvent);
				listener({
					type: "message_update",
					message: { role: "assistant" },
					assistantMessageEvent: { type: "text_delta" },
				} as unknown as AgentSessionEvent);
			},
			getLastAssistantText(): string | undefined {
				return "done";
			},
			dispose(): void {},
		} as unknown as AgentSession;

		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession() {
				return session;
			},
			disposeSession(): boolean {
				return true;
			},
		};

		const fakeBot = new FakeTelegramBot([
			createContext({
				sendTyping: async () => {
					typingCalls += 1;
					return { ok: true };
				},
			}),
		]);

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;
		expect(typingCalls).toBeGreaterThan(0);
	});

	it("suppresses final delivery for exact NO_REPLY", async () => {
		const fakeBot = new FakeTelegramBot([createContext()]);
		const { runtime } = createFakeRuntime("NO_REPLY");

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;
		expect(fakeBot.sentTexts).toEqual([]);
	});

	it("delivers deferred attachments with the final reply", async () => {
		const route = createRouteTarget("user-alice");
		const attachmentPath = join(route.workspace, "report.txt");
		writeFileSync(attachmentPath, "report", "utf-8");
		const messagingState = new PhiMessagingSessionState();

		const session = {
			subscribe() {
				return () => {};
			},
			async sendUserMessage(): Promise<void> {
				messagingState.setDeferredMessage({
					attachments: [{ path: attachmentPath, name: "report.txt" }],
				});
			},
			getLastAssistantText(): string | undefined {
				return "done";
			},
			dispose(): void {},
		} as unknown as AgentSession;
		registerPhiMessagingSessionState(session, messagingState);

		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession() {
				return session;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const fakeBot = new FakeTelegramBot([createContext()]);

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": route,
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;
		expect(fakeBot.sentDocuments).toEqual([
			{
				chatId: "42",
				filePath: attachmentPath,
				fileName: "report.txt",
				caption: "done",
				replyToMessageId: undefined,
			},
		]);
	});

	it("delivers deferred attachments when final reply is NO_REPLY", async () => {
		const route = createRouteTarget("user-alice");
		const attachmentPath = join(route.workspace, "report.txt");
		writeFileSync(attachmentPath, "report", "utf-8");
		const messagingState = new PhiMessagingSessionState();

		const session = {
			subscribe() {
				return () => {};
			},
			async sendUserMessage(): Promise<void> {
				messagingState.setDeferredMessage({
					text: "report attached",
					attachments: [{ path: attachmentPath, name: "report.txt" }],
				});
			},
			getLastAssistantText(): string | undefined {
				return "NO_REPLY";
			},
			dispose(): void {},
		} as unknown as AgentSession;
		registerPhiMessagingSessionState(session, messagingState);

		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession() {
				return session;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const fakeBot = new FakeTelegramBot([createContext()]);

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": route,
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;
		expect(fakeBot.sentDocuments).toEqual([
			{
				chatId: "42",
				filePath: attachmentPath,
				fileName: "report.txt",
				caption: "report attached",
				replyToMessageId: undefined,
			},
		]);
	});

	it("renders mentions for the current sender", async () => {
		const messagingState = new PhiMessagingSessionState();
		const session = {
			subscribe() {
				return () => {};
			},
			async sendUserMessage(): Promise<void> {
				const sender = messagingState.getTurnContext()?.sender;
				if (!sender) {
					throw new Error("Missing sender");
				}
				messagingState.setDeferredMessage({
					text: "please review",
					attachments: [],
					mentions: [sender],
				});
			},
			getLastAssistantText(): string | undefined {
				return "NO_REPLY";
			},
			dispose(): void {},
		} as unknown as AgentSession;
		registerPhiMessagingSessionState(session, messagingState);

		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession() {
				return session;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const fakeBot = new FakeTelegramBot([
			createContext({
				message: {
					id: 10,
					text: "hello",
					attachments: [],
					sender: {
						userId: "100",
						username: "alice",
						displayName: "Alice",
					},
				},
			}),
		]);

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;
		expect(fakeBot.sentTexts).toEqual([
			{
				chatId: "42",
				text: "@alice\n\nplease review",
				replyToMessageId: undefined,
			},
		]);
	});

	it("fails fast when a mention has no telegram username", async () => {
		const messagingState = new PhiMessagingSessionState();
		const session = {
			subscribe() {
				return () => {};
			},
			async sendUserMessage(): Promise<void> {
				const sender = messagingState.getTurnContext()?.sender;
				if (!sender) {
					throw new Error("Missing sender");
				}
				messagingState.setDeferredMessage({
					text: "please review",
					attachments: [],
					mentions: [sender],
				});
			},
			getLastAssistantText(): string | undefined {
				return "NO_REPLY";
			},
			dispose(): void {},
		} as unknown as AgentSession;
		registerPhiMessagingSessionState(session, messagingState);

		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession() {
				return session;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const fakeBot = new FakeTelegramBot([
			createContext({
				message: {
					id: 10,
					text: "hello",
					attachments: [],
					sender: {
						userId: "100",
						displayName: "Alice",
					},
				},
			}),
		]);

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => fakeBot }
		);

		await running.done;
		expect(fakeBot.sentTexts).toEqual([
			{
				chatId: "42",
				text: "Telegram mention requires username for user 100",
				replyToMessageId: undefined,
			},
		]);
	});
});
