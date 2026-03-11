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

import {
	resetPhiLoggerForTest,
	setPhiLoggerSettingsForTest,
} from "@phi/core/logger";
import type { ChatSessionRuntime } from "@phi/core/runtime";
import { PhiRouteDeliveryRegistry } from "@phi/messaging/route-delivery";
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
			await Promise.resolve();
			await Promise.resolve();
			return;
		}

		for (const update of this.updates) {
			await this.textMessageHandler(update);
		}
		await Promise.resolve();
		await Promise.resolve();
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
		deliverAs?: "steer" | "followUp";
	}>;
	disposeCalls: string[];
};

function createAssistantTurnEndEvent(text: string): AgentSessionEvent {
	return {
		type: "turn_end",
		turnIndex: 0,
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
		},
		toolResults: [],
	} as unknown as AgentSessionEvent;
}

function createUserMessageStartEvent(text: string): AgentSessionEvent {
	return {
		type: "message_start",
		message: {
			role: "user",
			content: [{ type: "text", text }],
		},
	} as unknown as AgentSessionEvent;
}

function createAgentEndEvent(text: string): AgentSessionEvent {
	return {
		type: "agent_end",
		messages: [
			{
				role: "assistant",
				content: [{ type: "text", text }],
			},
		],
	} as unknown as AgentSessionEvent;
}

function createFakeRuntime(responseText: string): {
	runtime: ChatSessionRuntime<AgentSession>;
	state: FakeRuntimeState;
} {
	const state: FakeRuntimeState = {
		calls: [],
		disposeCalls: [],
	};
	let listener: ((event: AgentSessionEvent) => void) | undefined;
	let currentChatId = "";

	const session = {
		isStreaming: false,
		subscribe(handler: (event: AgentSessionEvent) => void) {
			listener = handler;
			return () => {
				listener = undefined;
			};
		},
		async sendUserMessage(
			content: string | (TextContent | ImageContent)[],
			options?: { deliverAs?: "steer" | "followUp" }
		): Promise<void> {
			state.calls.push({
				chatId: currentChatId,
				prompt: content,
				deliverAs: options?.deliverAs,
			});
			listener?.(createAssistantTurnEndEvent(responseText));
			listener?.(createAgentEndEvent(responseText));
		},
		dispose(): void {},
	} as unknown as AgentSession;

	const runtime: ChatSessionRuntime<AgentSession> = {
		async getOrCreateSession(chatId: string) {
			currentChatId = chatId;
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

	it("steers same-chat updates when a session is already streaming", async () => {
		let listener: ((event: AgentSessionEvent) => void) | undefined;
		let releaseFirst: (() => void) | undefined;
		let streaming = false;
		let secondQueued = false;
		const calls: Array<{ text: string | undefined; deliverAs?: string }> =
			[];

		const session = {
			get isStreaming() {
				return streaming;
			},
			subscribe(handler: (event: AgentSessionEvent) => void) {
				listener = handler;
				return () => {
					listener = undefined;
				};
			},
			async sendUserMessage(
				content: string | (TextContent | ImageContent)[],
				options?: { deliverAs?: "steer" | "followUp" }
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
				calls.push({ text, deliverAs: options?.deliverAs });
				if (text === "m1") {
					listener?.(createUserMessageStartEvent("m1"));
					streaming = true;
					await new Promise<void>((resolve) => {
						releaseFirst = resolve;
					});
					listener?.(createAssistantTurnEndEvent("first reply"));
					if (secondQueued) {
						listener?.(createUserMessageStartEvent("m2"));
						listener?.(createAssistantTurnEndEvent("second reply"));
					}
					listener?.(
						createAgentEndEvent(
							secondQueued ? "second reply" : "first reply"
						)
					);
					streaming = false;
					return;
				}
				secondQueued = true;
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

		for (let attempt = 0; attempt < 10 && calls.length < 2; attempt += 1) {
			await Promise.resolve();
		}
		expect(calls).toEqual([
			{ text: "m1", deliverAs: undefined },
			{ text: "m2", deliverAs: "steer" },
		]);
		if (!releaseFirst) {
			throw new Error("First resolver was not assigned.");
		}
		releaseFirst();

		await running.done;
		expect(fakeBot.sentTexts.map((entry) => entry.text)).toEqual([
			"second reply",
		]);
	});

	it("delivers only the final assistant turn after tool retries", async () => {
		let listener: ((event: AgentSessionEvent) => void) | undefined;
		const session = {
			isStreaming: false,
			subscribe(handler: (event: AgentSessionEvent) => void) {
				listener = handler;
				return () => {
					listener = undefined;
				};
			},
			async sendUserMessage(): Promise<void> {
				listener?.(createUserMessageStartEvent("hello"));
				listener?.(createAssistantTurnEndEvent("I will handle it."));
				listener?.(createAssistantTurnEndEvent("done"));
				listener?.(createAgentEndEvent("done"));
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
		const fakeBot = new FakeTelegramBot([createContext()]);

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
				text: "done",
				replyToMessageId: undefined,
			},
		]);
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

	it("allows retrying the same update after a failed attempt", async () => {
		const route = createRouteTarget("user-alice");
		const fakeBot = new FakeTelegramBot([
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello", attachments: [] },
			}),
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello", attachments: [] },
			}),
		]);
		const { runtime: successRuntime, state } =
			createFakeRuntime("assistant reply");
		let attempt = 0;

		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession(chatId: string) {
				attempt += 1;
				if (attempt === 1) {
					throw new Error("runtime unavailable");
				}
				return await successRuntime.getOrCreateSession(chatId);
			},
			disposeSession(chatId: string): boolean {
				return successRuntime.disposeSession(chatId);
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
		expect(state.calls).toHaveLength(1);
		expect(fakeBot.sentTexts).toEqual([
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

	it("sends typing for assistant thoughts and text, not tool calls", async () => {
		let listener: ((event: AgentSessionEvent) => void) | undefined;
		let typingCalls = 0;

		const session = {
			isStreaming: false,
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
				listener(createAssistantTurnEndEvent("done"));
				listener(createAgentEndEvent("done"));
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

	it("delivers literal NO_REPLY as plain assistant text without messaging extension", async () => {
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
		expect(fakeBot.sentTexts).toEqual([
			{
				chatId: "42",
				text: "NO_REPLY",
				replyToMessageId: undefined,
			},
		]);
	});

	it("skips fallback final delivery when messaging is extension-managed", async () => {
		let listener: ((event: AgentSessionEvent) => void) | undefined;
		const session = {
			isStreaming: false,
			getAllTools() {
				return [{ name: "send" }];
			},
			subscribe(handler: (event: AgentSessionEvent) => void) {
				listener = handler;
				return () => {
					listener = undefined;
				};
			},
			async sendUserMessage(): Promise<void> {
				listener?.(createAssistantTurnEndEvent("done"));
				listener?.(createAgentEndEvent("done"));
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
		const fakeBot = new FakeTelegramBot([createContext()]);

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatRoutes: {
					"42": createRouteTarget("user-alice"),
				},
			},
			{ createBot: () => fakeBot },
			new PhiRouteDeliveryRegistry()
		);

		await running.done;
		expect(fakeBot.sentTexts).toEqual([]);
	});

	it("re-evaluates messaging mode after workspace config changes", async () => {
		const route = createRouteTarget("user-alice");
		const listenerBySession = new Map<
			number,
			(event: AgentSessionEvent) => void
		>();
		const sessionOne = {
			isStreaming: false,
			subscribe(handler: (event: AgentSessionEvent) => void) {
				listenerBySession.set(1, handler);
				return () => {
					listenerBySession.delete(1);
				};
			},
			async sendUserMessage(): Promise<void> {
				listenerBySession.get(1)?.(
					createAssistantTurnEndEvent("first")
				);
				listenerBySession.get(1)?.(createAgentEndEvent("first"));
			},
			dispose(): void {},
		} as unknown as AgentSession;
		const sessionTwo = {
			isStreaming: false,
			subscribe(handler: (event: AgentSessionEvent) => void) {
				listenerBySession.set(2, handler);
				return () => {
					listenerBySession.delete(2);
				};
			},
			async sendUserMessage(): Promise<void> {
				listenerBySession.get(2)?.(
					createAssistantTurnEndEvent("second")
				);
				listenerBySession.get(2)?.(createAgentEndEvent("second"));
			},
			dispose(): void {},
		} as unknown as AgentSession;
		let getSessionCalls = 0;
		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession() {
				getSessionCalls += 1;
				if (getSessionCalls === 1) {
					return sessionOne;
				}
				writeFileSync(
					join(route.workspace, ".phi", "config.yaml"),
					[
						"version: 1",
						"extensions:",
						"  disabled:",
						"    - messaging",
					].join("\n"),
					"utf-8"
				);
				return sessionTwo;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const fakeBot = new FakeTelegramBot([
			createContext({
				chat: { id: 42 },
				message: { id: 10, text: "m1", attachments: [] },
			}),
			createContext({
				chat: { id: 42 },
				message: { id: 11, text: "m2", attachments: [] },
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
			{ createBot: () => fakeBot },
			new PhiRouteDeliveryRegistry()
		);

		await running.done;
		expect(fakeBot.sentTexts).toEqual([
			{
				chatId: "42",
				text: "second",
				replyToMessageId: undefined,
			},
		]);
	});
});
