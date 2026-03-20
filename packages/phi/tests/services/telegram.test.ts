import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import type { PhiMessage } from "@phi/messaging/types";
import type { Session } from "@phi/services/session";
import { ServiceRoutes, type InteractiveInput } from "@phi/services/routes";
import {
	startTelegramEndpoint,
	type TelegramRouteTarget,
} from "@phi/services/telegram";
import type {
	TelegramBotFactory,
	TelegramBotLike,
} from "@phi/services/endpoints";

interface FakeTelegramUpdate {
	endpointChatId: string;
	messageId: number;
	text?: string;
}

type FakeContext = Record<string, unknown>;

class FakeTelegramBot implements TelegramBotLike {
	private messageHandler?: (ctx: FakeContext) => Promise<void>;

	public startCalls = 0;
	public stopCalls = 0;
	public sentTexts: Array<{ chatId: string; text: string }> = [];

	public constructor(private readonly updates: FakeTelegramUpdate[]) {}

	public get api() {
		return {
			sendMessage: async (chatId: string, text: string) => {
				this.sentTexts.push({ chatId, text });
				return { ok: true };
			},
			sendPhoto: async () => ({ ok: true }),
			sendDocument: async () => ({ ok: true }),
			sendChatAction: async () => ({ ok: true }),
			getFile: async () => ({ file_path: undefined }),
			token: "fake-token",
		};
	}

	public on(_event: unknown, handler: unknown): void {
		this.messageHandler = handler as (ctx: FakeContext) => Promise<void>;
	}

	public catch(_handler: unknown): void {}

	public async start(): Promise<void> {
		this.startCalls += 1;
		if (!this.messageHandler) {
			throw new Error("Message handler was not registered.");
		}
		for (const update of this.updates) {
			await this.messageHandler({
				message: {
					message_id: update.messageId,
					text: update.text,
					chat: { id: Number(update.endpointChatId) },
				},
				chat: { id: Number(update.endpointChatId) },
				update: { update_id: update.messageId + 1000 },
				api: this.api,
			});
		}
	}

	public async stop(): Promise<void> {
		this.stopCalls += 1;
	}
}

class FailingTelegramBot extends FakeTelegramBot {
	public constructor(
		updates: FakeTelegramUpdate[],
		private readonly errorMessage: string
	) {
		super(updates);
	}

	public override async start(): Promise<void> {
		await super.start();
		throw new Error(this.errorMessage);
	}
}

const createdWorkspaces: string[] = [];

function createRouteTarget(params: {
	sessionId: string;
	chatId: string;
}): TelegramRouteTarget {
	const workspace = mkdtempSync(join(tmpdir(), "phi-telegram-workspace-"));
	createdWorkspaces.push(workspace);
	return { sessionId: params.sessionId, chatId: params.chatId, workspace };
}

function createSession(overrides: Partial<Session> = {}): Session {
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

afterEach(() => {
	for (const workspace of createdWorkspaces) {
		rmSync(workspace, { recursive: true, force: true });
	}
	createdWorkspaces.length = 0;
});

describe("startTelegramEndpoint", () => {
	it("routes telegram messages to the configured session", async () => {
		const bot = new FakeTelegramBot([
			{ endpointChatId: "42", messageId: 1, text: "hello" },
		]);
		const routes = new ServiceRoutes();
		const submissions: InteractiveInput[] = [];
		routes.registerSession(
			"alice-telegram",
			createSession({
				async submitInteractive(input): Promise<void> {
					submissions.push(input);
				},
			})
		);

		const endpoint = await startTelegramEndpoint(
			routes,
			{
				token: "bot-token",
				chatRoutes: {
					"42": createRouteTarget({
						sessionId: "alice-telegram",
						chatId: "alice",
					}),
				},
			},
			createBotFactory(bot)
		);
		await endpoint.done;
		await endpoint.stop();

		expect(submissions).toHaveLength(1);
		expect(submissions[0]?.text).toBe("hello");
	});

	it("registers outbound delivery per session", async () => {
		const bot = new FakeTelegramBot([]);
		const routes = new ServiceRoutes();

		const endpoint = await startTelegramEndpoint(
			routes,
			{
				token: "bot-token",
				chatRoutes: {
					"42": createRouteTarget({
						sessionId: "alice-telegram",
						chatId: "alice",
					}),
				},
			},
			createBotFactory(bot)
		);
		await routes.deliverOutbound("alice-telegram", {
			text: "done",
			attachments: [],
		});
		await endpoint.stop();

		expect(bot.sentTexts).toEqual([{ chatId: "42", text: "done" }]);
	});

	it("routes replies through the active telegram allowList route", async () => {
		const bot = new FakeTelegramBot([
			{ endpointChatId: "43", messageId: 1, text: "hello" },
		]);
		const routes = new ServiceRoutes();
		routes.registerSession(
			"alice-telegram",
			createSession({
				async submitInteractive(): Promise<void> {
					await routes.deliverOutbound("alice-telegram", {
						text: "reply",
						attachments: [],
					});
				},
			})
		);

		const endpoint = await startTelegramEndpoint(
			routes,
			{
				token: "bot-token",
				chatRoutes: {
					"42": createRouteTarget({
						sessionId: "alice-telegram",
						chatId: "alice",
					}),
					"43": createRouteTarget({
						sessionId: "alice-telegram",
						chatId: "alice",
					}),
				},
			},
			createBotFactory(bot)
		);
		await endpoint.done;
		await endpoint.stop();

		expect(bot.sentTexts).toEqual([{ chatId: "43", text: "reply" }]);
	});

	it("unregisters routes when the bot exits with error", async () => {
		const bot = new FailingTelegramBot([], "telegram crashed");
		const routes = new ServiceRoutes();

		const endpoint = await startTelegramEndpoint(
			routes,
			{
				token: "bot-token",
				chatRoutes: {
					"42": createRouteTarget({
						sessionId: "alice-telegram",
						chatId: "alice",
					}),
				},
			},
			createBotFactory(bot)
		);

		await expect(endpoint.done).rejects.toThrow("telegram crashed");
		await expect(
			routes.deliverOutbound("alice-telegram", {
				text: "done",
				attachments: [],
			})
		).rejects.toThrow(
			"No outbound route configured for session alice-telegram"
		);
	});
});
