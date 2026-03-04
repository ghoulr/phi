import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import type {
	AgentSession,
	AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";

import {
	startTelegramPollingBot,
	type TelegramPollingBot,
	type TelegramRouteTarget,
	type TelegramTextMessageContext,
} from "@phi/services/telegram";
import type { ChatSessionRuntime } from "@phi/core/runtime";

class FakeTelegramBot implements TelegramPollingBot {
	private textMessageHandler?: (
		context: TelegramTextMessageContext
	) => Promise<void>;
	private errorHandler?: (error: unknown) => void;

	public startCalls = 0;
	public stopCalls = 0;

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
	calls: Array<{ chatId: string; prompt: string }>;
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
			return {
				subscribe() {
					return () => {};
				},
				async sendUserMessage(text: string): Promise<void> {
					state.calls.push({
						chatId,
						prompt: text,
					});
				},
				getLastAssistantText(): string | undefined {
					return responseText;
				},
				dispose(): void {},
			} as unknown as AgentSession;
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

function createRouteTarget(chatId: string): TelegramRouteTarget {
	const workspace = mkdtempSync(join(tmpdir(), "phi-telegram-workspace-"));
	createdWorkspaces.push(workspace);
	return { chatId, workspace };
}

afterEach(() => {
	for (const workspace of createdWorkspaces) {
		rmSync(workspace, { recursive: true, force: true });
	}
	createdWorkspaces.length = 0;
});

function createContext(
	overrides?: Partial<TelegramTextMessageContext>
): TelegramTextMessageContext {
	return {
		updateId: nextUpdateId++,
		chat: { id: 42 },
		message: { id: 10, text: "hello" },
		reply: async () => ({ ok: true }),
		sendTyping: async () => ({ ok: true }),
		...overrides,
	};
}

describe("telegram service", () => {
	it("routes telegram message to configured chat", async () => {
		const replies: string[] = [];
		const fakeBot = new FakeTelegramBot([
			createContext({
				message: { id: 10, text: "hello from telegram" },
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
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

		expect(state.calls).toEqual([
			{
				chatId: "user-alice",
				prompt: "hello from telegram",
			},
		]);
		expect(replies).toEqual(["assistant reply"]);
		expect(fakeBot.startCalls).toBe(1);
		expect(state.disposeCalls).toEqual(["user-alice"]);
	});

	it("serializes same-chat jobs when updates arrive concurrently", async () => {
		const replies: string[] = [];
		let releaseFirst: (() => void) | undefined;
		const order: string[] = [];

		const session = {
			subscribe() {
				return () => {};
			},
			async sendUserMessage(text: string): Promise<void> {
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
					message: { id: 101, text: "m1" },
					reply: async (text: string) => {
						replies.push(text);
						return { ok: true };
					},
				}),
				createContext({
					chat: { id: 7 },
					message: { id: 102, text: "m2" },
					reply: async (text: string) => {
						replies.push(text);
						return { ok: true };
					},
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

		await Promise.resolve();
		expect(order).toEqual(["start1"]);
		if (!releaseFirst) {
			throw new Error("First resolver was not assigned.");
		}
		releaseFirst();

		await running.done;
		expect(order).toEqual(["start1", "end1", "start2", "end2"]);
		expect(replies).toEqual(["ok", "ok"]);
	});

	it("replies request error text for unknown chat route", async () => {
		const replies: string[] = [];
		const fakeBot = new FakeTelegramBot([
			createContext({
				chat: { id: 999 },
				message: { id: 10, text: "unknown chat" },
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
				},
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
		expect(replies).toEqual([
			"No agent configured for telegram chat id: 999",
		]);
	});

	it("replies request error text for invalid message payload", async () => {
		const replies: string[] = [];
		const fakeBot = new FakeTelegramBot([
			createContext({
				message: { id: 10, text: "a\u0000b" },
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
				},
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
		expect(replies).toEqual(["message must not contain null bytes"]);
	});

	it("replies request error text for internal runtime failure", async () => {
		const route = createRouteTarget("user-alice");
		const replies: string[] = [];
		const fakeBot = new FakeTelegramBot([
			createContext({
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
				},
			}),
		]);

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
		expect(replies).toEqual(["runtime unavailable"]);

		const logsContent = readFileSync(
			join(route.workspace, ".phi", "logs", "logs.jsonl"),
			"utf-8"
		);
		expect(logsContent.includes('"direction":"inbound"')).toBe(true);
		expect(logsContent.includes('"source":"error"')).toBe(true);
		expect(logsContent.includes('"text":"runtime unavailable"')).toBe(true);
	});

	it("sanitizes request error text before replying", async () => {
		const replies: string[] = [];
		const fakeBot = new FakeTelegramBot([
			createContext({
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
				},
			}),
		]);

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
		expect(replies).toEqual(["abc"]);
	});

	it("sanitizes and chunks long assistant replies", async () => {
		const replies: string[] = [];
		const fakeBot = new FakeTelegramBot([
			createContext({
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
				},
			}),
		]);
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
		expect(replies.length).toBeGreaterThan(1);
		expect(replies.every((chunk) => chunk.length <= 4096)).toBe(true);
		expect(replies.join("")).toBe(`${"a".repeat(4200)}${"b".repeat(120)}`);
	});

	it("skips duplicate updates after processed state in logs", async () => {
		const route = createRouteTarget("user-alice");
		const replies: string[] = [];
		const { runtime, state } = createFakeRuntime("assistant reply");
		const fakeBot = new FakeTelegramBot([
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello" },
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
				},
			}),
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello" },
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
				},
			}),
			createContext({
				updateId: 100,
				message: { id: 1, text: "hello" },
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
				},
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
		expect(replies).toEqual(["assistant reply"]);

		const logsContent = readFileSync(
			join(route.workspace, ".phi", "logs", "logs.jsonl"),
			"utf-8"
		);
		expect(logsContent.includes('"direction":"outbound"')).toBe(true);
		expect(logsContent.includes('"source":"assistant"')).toBe(true);
		const lines = logsContent.split("\n").filter((line) => line.length > 0);
		expect(lines).toHaveLength(2);
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
});
