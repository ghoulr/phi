import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { Bot, type BotError, type Context } from "grammy";

import type { AgentConversationRuntime } from "@phi/core/runtime";

export interface TelegramTextMessageContext {
	chat: { id: number | string };
	message: { text: string };
	from?: { id: number | string };
	reply(text: string): Promise<unknown>;
}

export interface TelegramPollingBot {
	onTextMessage(
		handler: (context: TelegramTextMessageContext) => Promise<void>
	): void;
	onError(handler: (error: unknown) => void): void;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface TelegramCommandDependencies {
	createBot(token: string): TelegramPollingBot;
}

export interface RunningTelegramPollingBot {
	done: Promise<void>;
	stop(): Promise<void>;
}

export interface ResolvedTelegramPollingBotConfig {
	token: string;
	chatAgentRoutes: Record<string, string>;
}

function normalizeError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	return new Error(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function summarizeMessage(message: unknown): Record<string, unknown> {
	if (!isRecord(message)) {
		return { type: typeof message };
	}

	const summary: Record<string, unknown> = {
		role: typeof message.role === "string" ? message.role : "unknown",
	};

	if (typeof message.stopReason === "string") {
		summary.stopReason = message.stopReason;
	}
	if (typeof message.errorMessage === "string") {
		summary.errorMessage = message.errorMessage;
	}

	if (Array.isArray(message.content)) {
		summary.contentTypes = message.content.map((content) => {
			if (isRecord(content) && typeof content.type === "string") {
				return content.type;
			}
			return "unknown";
		});
		const textParts = message.content
			.map((content) => {
				if (
					isRecord(content) &&
					content.type === "text" &&
					typeof content.text === "string"
				) {
					return content.text;
				}
				return "";
			})
			.filter((part) => part.length > 0);
		if (textParts.length > 0) {
			summary.textPreview = textParts.join("\n").slice(0, 200);
		}
	}

	return summary;
}

function summarizeSessionTail(
	session: AgentSession,
	count: number = 3
): Array<Record<string, unknown>> {
	const tail = session.state.messages.slice(-count);
	return tail.map((message) => summarizeMessage(message));
}

function summarizeLastAssistantMessage(
	session: AgentSession
): Record<string, unknown> | undefined {
	for (
		let index = session.state.messages.length - 1;
		index >= 0;
		index -= 1
	) {
		const message = session.state.messages[index];
		if (isRecord(message) && message.role === "assistant") {
			return summarizeMessage(message);
		}
	}
	return undefined;
}

class GrammyPollingBot implements TelegramPollingBot {
	private readonly bot: Bot;

	public constructor(token: string) {
		this.bot = new Bot(token);
	}

	public onTextMessage(
		handler: (context: TelegramTextMessageContext) => Promise<void>
	): void {
		this.bot.on("message:text", async (context: Context) => {
			const message = context.message;
			if (!message || typeof message.text !== "string") {
				return;
			}
			if (!context.chat) {
				throw new Error("Telegram update is missing chat information.");
			}
			await handler({
				chat: { id: context.chat.id },
				message: { text: message.text },
				from: context.from ? { id: context.from.id } : undefined,
				reply: async (text: string) => {
					return context.reply(text);
				},
			});
		});
	}

	public onError(handler: (error: unknown) => void): void {
		this.bot.catch((error: BotError<Context>) => {
			handler(error.error);
		});
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

const defaultTelegramCommandDependencies: TelegramCommandDependencies = {
	createBot(token: string): TelegramPollingBot {
		return new GrammyPollingBot(token);
	},
};

export function createTelegramConversationKey(chatId: number | string): string {
	return `telegram:chat:${chatId}`;
}

function shouldSkipServiceMessage(text: string): boolean {
	return text.trimStart().startsWith("/");
}

async function handleTelegramTextMessage(
	runtime: AgentConversationRuntime<AgentSession>,
	chatAgentRoutes: Record<string, string>,
	context: TelegramTextMessageContext
): Promise<void> {
	if (shouldSkipServiceMessage(context.message.text)) {
		console.log(
			`[telegram] Skip slash command message. chatId=${String(context.chat.id)}`
		);
		return;
	}

	if (!context.from) {
		throw new Error("Telegram update is missing sender information.");
	}

	const chatId = String(context.chat.id);
	const fromId = String(context.from.id);
	const agentId = chatAgentRoutes[chatId];
	if (!agentId) {
		throw new Error(`Unknown telegram chat mapping for chat id: ${chatId}`);
	}

	const textPreview = context.message.text.slice(0, 200);
	const conversationKey = createTelegramConversationKey(context.chat.id);
	console.log(
		`[telegram] Route message. chatId=${chatId} fromId=${fromId} agentId=${agentId} conversationKey=${conversationKey} textLength=${context.message.text.length} textPreview=${JSON.stringify(textPreview)}`
	);

	const session = await runtime.getOrCreateSession(agentId, conversationKey);
	const startedAt = Date.now();
	await session.sendUserMessage(context.message.text);
	const elapsedMs = Date.now() - startedAt;

	const assistantText = session.getLastAssistantText();
	if (!assistantText) {
		const lastAssistant = summarizeLastAssistantMessage(session);
		const tail = summarizeSessionTail(session);
		console.error(
			`[telegram] Empty assistant response. conversationKey=${conversationKey} elapsedMs=${elapsedMs} lastAssistant=${JSON.stringify(lastAssistant)} tail=${JSON.stringify(tail)}`
		);

		if (lastAssistant && typeof lastAssistant.stopReason === "string") {
			let errorMessage: string | undefined;
			if (
				typeof lastAssistant.errorMessage === "string" &&
				lastAssistant.errorMessage.length > 0
			) {
				errorMessage = lastAssistant.errorMessage;
			} else if (lastAssistant.stopReason === "aborted") {
				const retryAttempt = session.retryAttempt;
				errorMessage =
					retryAttempt > 0
						? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
						: "Operation aborted";
			} else if (lastAssistant.stopReason === "error") {
				errorMessage = "Error";
			}

			if (errorMessage) {
				console.log(
					`[telegram] Reply assistant failure. chatId=${chatId} conversationKey=${conversationKey} stopReason=${lastAssistant.stopReason}`
				);
				await context.reply(errorMessage.slice(0, 3500));
				return;
			}
		}

		throw new Error(
			`Assistant returned empty response for conversation ${conversationKey}`
		);
	}

	console.log(
		`[telegram] Reply message. chatId=${chatId} conversationKey=${conversationKey} elapsedMs=${elapsedMs} replyLength=${assistantText.length} replyPreview=${JSON.stringify(assistantText.slice(0, 200))}`
	);
	await context.reply(assistantText);
}

export async function startTelegramPollingBot(
	runtime: AgentConversationRuntime<AgentSession>,
	config: ResolvedTelegramPollingBotConfig,
	dependencies: TelegramCommandDependencies = defaultTelegramCommandDependencies
): Promise<RunningTelegramPollingBot> {
	const bot = dependencies.createBot(config.token);
	console.log(
		`[telegram] Start polling bot. routedChats=${Object.keys(config.chatAgentRoutes).length}`
	);

	bot.onError((error: unknown) => {
		const normalizedError = normalizeError(error);
		console.error(
			`[telegram] Channel error: ${normalizedError.message}\n${normalizedError.stack ?? ""}`
		);
		queueMicrotask(() => {
			throw normalizedError;
		});
	});

	bot.onTextMessage(async (context: TelegramTextMessageContext) => {
		await handleTelegramTextMessage(
			runtime,
			config.chatAgentRoutes,
			context
		);
	});

	const done = bot.start().finally(() => {
		console.log(
			"[telegram] Stop polling bot and dispose routed agent sessions."
		);
		for (const agentId of new Set(Object.values(config.chatAgentRoutes))) {
			runtime.disposeAllSessions(agentId);
		}
	});

	return {
		done,
		async stop(): Promise<void> {
			await bot.stop();
		},
	};
}
