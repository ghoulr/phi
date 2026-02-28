import { describe, expect, it } from "bun:test";

import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	createTelegramConversationKey,
	startTelegramPollingBot,
	type TelegramPollingBot,
	type TelegramTextMessageContext,
} from "@phi/commands/telegram";
import type { AgentConversationRuntime } from "@phi/core/runtime";

class FakeTelegramBot implements TelegramPollingBot {
	private textMessageHandler?: (
		context: TelegramTextMessageContext
	) => Promise<void>;
	private errorHandler?: (error: unknown) => void;

	public startCalls = 0;
	public stopCalls = 0;

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
		if (!this.errorHandler) {
			throw new Error("Error handler was not registered.");
		}
		this.errorHandler(error);
	}
}

type FakeRuntimeState = {
	calls: Array<{ agentId: string; conversationKey: string; prompt: string }>;
	disposeCalls: string[];
};

function createFakeRuntime(responseText: string): {
	runtime: AgentConversationRuntime<AgentSession>;
	state: FakeRuntimeState;
} {
	const state: FakeRuntimeState = {
		calls: [],
		disposeCalls: [],
	};

	const runtime: AgentConversationRuntime<AgentSession> = {
		async getOrCreateSession(agentId: string, conversationKey: string) {
			return {
				async sendUserMessage(text: string): Promise<void> {
					state.calls.push({
						agentId,
						conversationKey,
						prompt: text,
					});
				},
				getLastAssistantText(): string | undefined {
					return responseText;
				},
				dispose(): void {},
			} as unknown as AgentSession;
		},
		disposeSession(): boolean {
			return false;
		},
		disposeAllSessions(agentId?: string): void {
			if (agentId) {
				state.disposeCalls.push(agentId);
			}
		},
	};

	return { runtime, state };
}

describe("telegram command", () => {
	it("builds deterministic telegram conversation key", () => {
		expect(createTelegramConversationKey(456)).toBe("telegram:chat:456");
	});

	it("routes telegram text update by chat id", async () => {
		const replies: string[] = [];
		const fakeBot = new FakeTelegramBot([
			{
				chat: { id: 42 },
				message: { text: "hello from telegram" },
				from: { id: 7 },
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
				},
			},
		]);
		const { runtime, state } = createFakeRuntime("assistant reply");

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatAgentRoutes: {
					"42": "support",
				},
			},
			{
				createBot: () => fakeBot,
			}
		);
		await running.done;

		expect(state.calls).toEqual([
			{
				agentId: "support",
				conversationKey: "telegram:chat:42",
				prompt: "hello from telegram",
			},
		]);
		expect(replies).toEqual(["assistant reply"]);
		expect(fakeBot.startCalls).toBe(1);
		expect(state.disposeCalls).toEqual(["support"]);
	});

	it("skips slash command message in service layer", async () => {
		const replies: string[] = [];
		const fakeBot = new FakeTelegramBot([
			{
				chat: { id: 42 },
				message: { text: "/start" },
				from: { id: 7 },
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
				},
			},
		]);
		const { runtime, state } = createFakeRuntime("assistant reply");

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatAgentRoutes: {
					"42": "support",
				},
			},
			{
				createBot: () => fakeBot,
			}
		);
		await running.done;

		expect(state.calls).toEqual([]);
		expect(replies).toEqual([]);
	});

	it("fails when chat id is not configured", async () => {
		const fakeBot = new FakeTelegramBot([
			{
				chat: { id: 999 },
				message: { text: "unknown chat" },
				from: { id: 7 },
				reply: async () => ({ ok: true }),
			},
		]);
		const { runtime } = createFakeRuntime("unused");

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatAgentRoutes: {
					"42": "main",
				},
			},
			{
				createBot: () => fakeBot,
			}
		);

		await expect(running.done).rejects.toThrow(
			"Unknown telegram chat mapping for chat id: 999"
		);
	});

	it("fails when telegram update has no sender", async () => {
		const fakeBot = new FakeTelegramBot([
			{
				chat: { id: 42 },
				message: { text: "anonymous" },
				reply: async () => ({ ok: true }),
			},
		]);
		const { runtime } = createFakeRuntime("unused");

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatAgentRoutes: {
					"42": "main",
				},
			},
			{
				createBot: () => fakeBot,
			}
		);
		await expect(running.done).rejects.toThrow(
			"Telegram update is missing sender information."
		);
	});

	it("replies upstream assistant error details to telegram user", async () => {
		const replies: string[] = [];
		const fakeBot = new FakeTelegramBot([
			{
				chat: { id: 42 },
				message: { text: "hello" },
				from: { id: 7 },
				reply: async (text: string) => {
					replies.push(text);
					return { ok: true };
				},
			},
		]);

		const runtime: AgentConversationRuntime<AgentSession> = {
			async getOrCreateSession() {
				return {
					async sendUserMessage(): Promise<void> {},
					getLastAssistantText(): string | undefined {
						return undefined;
					},
					state: {
						messages: [
							{
								role: "assistant",
								stopReason: "error",
								errorMessage: "429 rate limit",
								content: [],
							},
						],
					},
					dispose(): void {},
				} as unknown as AgentSession;
			},
			disposeSession(): boolean {
				return false;
			},
			disposeAllSessions(): void {},
		};

		const running = await startTelegramPollingBot(
			runtime,
			{
				token: "test-token",
				chatAgentRoutes: {
					"42": "main",
				},
			},
			{
				createBot: () => fakeBot,
			}
		);

		await running.done;
		expect(replies).toEqual(["429 rate limit"]);
	});
});
