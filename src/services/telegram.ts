import type {
	AgentSession,
	AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import { Bot, type BotError, type Context } from "grammy";

import {
	InMemoryChatExecutor,
	type ChatExecutor,
} from "@phi/core/chat-executor";
import {
	appendChatLogEntry,
	hasOutboundChatLogEntry,
} from "@phi/core/chat-log";
import {
	ensureChatWorkspaceLayout,
	getChatLogsFilePath,
	resolveChatWorkspaceDirectory,
} from "@phi/core/chat-workspace";
import {
	chunkTextForOutbound,
	sanitizeInboundText,
	sanitizeOutboundText,
} from "@phi/core/message-text";
import type { ChatSessionRuntime } from "@phi/core/runtime";
import {
	formatUserFacingErrorMessage,
	normalizeUnknownError,
} from "@phi/core/user-error";

const TELEGRAM_TEXT_LIMIT = 4096;
const TYPING_INTERVAL_MS = 2500;

export interface TelegramTextMessageContext {
	updateId: number;
	chat: { id: number | string };
	message: { id: number | string; text: string };
	reply(text: string): Promise<unknown>;
	sendTyping(): Promise<unknown>;
}

export interface TelegramPollingBot {
	onTextMessage(
		handler: (context: TelegramTextMessageContext) => Promise<void>
	): void;
	onError(handler: (error: unknown) => void): void;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface TelegramServiceDependencies {
	createBot(token: string): TelegramPollingBot;
}

export interface RunningTelegramPollingBot {
	done: Promise<void>;
	stop(): Promise<void>;
}

export interface TelegramRouteTarget {
	chatId: string;
	workspace: string;
}

export interface ResolvedTelegramPollingBotConfig {
	token: string;
	chatRoutes: Record<string, TelegramRouteTarget>;
}

function createTelegramIdempotencyKey(
	telegramChatId: string,
	updateId: number
): string {
	return `telegram:${telegramChatId}:${String(updateId)}`;
}

function normalizeTelegramChatId(value: number | string): string {
	return String(value);
}

function normalizeTelegramMessageId(value: number | string): string {
	return String(value);
}

function normalizeTelegramUpdateId(value: number): string {
	return String(value);
}

function shouldShowTypingForEvent(event: AgentSessionEvent): boolean {
	if (event.type !== "message_update") {
		return false;
	}
	if (event.message.role !== "assistant") {
		return false;
	}

	switch (event.assistantMessageEvent.type) {
		case "thinking_start":
		case "thinking_delta":
		case "thinking_end":
		case "text_start":
		case "text_delta":
		case "text_end":
			return true;
		default:
			return false;
	}
}

function createTypingNotifier(sendTyping: () => Promise<unknown>): {
	notify(): void;
	stop(): void;
} {
	let stopped = false;
	let sending = false;
	let lastSentAt = 0;

	return {
		notify(): void {
			if (stopped || sending) {
				return;
			}
			if (Date.now() - lastSentAt < TYPING_INTERVAL_MS) {
				return;
			}

			sending = true;
			void sendTyping().then(
				() => {
					sending = false;
					lastSentAt = Date.now();
				},
				() => {
					sending = false;
					lastSentAt = Date.now();
				}
			);
		},
		stop(): void {
			stopped = true;
		},
	};
}

async function replyTextInChunks(
	context: TelegramTextMessageContext,
	text: string
): Promise<void> {
	const sanitized = sanitizeOutboundText(text);
	const chunks = chunkTextForOutbound(sanitized, TELEGRAM_TEXT_LIMIT);
	if (chunks.length === 0) {
		throw new Error("Outbound message is empty after sanitization.");
	}
	for (const chunk of chunks) {
		await context.reply(chunk);
	}
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
			const chat = context.chat;
			if (!chat) {
				throw new Error("Telegram update is missing chat information.");
			}
			await handler({
				updateId: context.update.update_id,
				chat: { id: chat.id },
				message: {
					id: message.message_id,
					text: message.text,
				},
				reply: async (text: string) => {
					return context.reply(text);
				},
				sendTyping: async () => {
					return context.api.sendChatAction(chat.id, "typing");
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

const defaultTelegramServiceDependencies: TelegramServiceDependencies = {
	createBot(token: string): TelegramPollingBot {
		return new GrammyPollingBot(token);
	},
};

async function processTelegramAgentTurn(
	runtime: ChatSessionRuntime<AgentSession>,
	target: TelegramRouteTarget,
	context: TelegramTextMessageContext
): Promise<string> {
	const inboundResult = sanitizeInboundText(context.message.text);
	if (!inboundResult.ok) {
		throw new Error(inboundResult.error);
	}

	const session = await runtime.getOrCreateSession(target.chatId);
	const typingNotifier = createTypingNotifier(context.sendTyping);
	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		if (shouldShowTypingForEvent(event)) {
			typingNotifier.notify();
		}
	});

	try {
		typingNotifier.notify();
		await session.sendUserMessage(inboundResult.message);
	} finally {
		unsubscribe();
		typingNotifier.stop();
	}

	const assistantText = session.getLastAssistantText();
	if (!assistantText) {
		throw new Error(
			`Assistant returned empty response for chat ${target.chatId}`
		);
	}

	return assistantText;
}

async function handleTelegramTextMessage(
	runtime: ChatSessionRuntime<AgentSession>,
	chatRoutes: Record<string, TelegramRouteTarget>,
	context: TelegramTextMessageContext
): Promise<void> {
	const telegramChatId = normalizeTelegramChatId(context.chat.id);
	const target = chatRoutes[telegramChatId];
	if (!target) {
		throw new Error(
			`No agent configured for telegram chat id: ${telegramChatId}`
		);
	}

	const workspaceDir = resolveChatWorkspaceDirectory(target.workspace);
	ensureChatWorkspaceLayout(workspaceDir);
	const logsFilePath = getChatLogsFilePath(workspaceDir);
	const idempotencyKey = createTelegramIdempotencyKey(
		telegramChatId,
		context.updateId
	);
	const telegramUpdateId = normalizeTelegramUpdateId(context.updateId);
	const telegramMessageId = normalizeTelegramMessageId(context.message.id);
	if (hasOutboundChatLogEntry(logsFilePath, idempotencyKey)) {
		return;
	}

	appendChatLogEntry(logsFilePath, {
		idempotencyKey,
		channel: "telegram",
		chatId: target.chatId,
		telegramChatId,
		telegramUpdateId,
		telegramMessageId,
		direction: "inbound",
		source: "user",
		text: context.message.text,
	});

	let outboundText: string;
	let outboundSource: "assistant" | "error" = "assistant";

	try {
		outboundText = await processTelegramAgentTurn(runtime, target, context);
	} catch (error: unknown) {
		outboundText = formatUserFacingErrorMessage(error);
		outboundSource = "error";
	}

	await replyTextInChunks(context, outboundText);
	appendChatLogEntry(logsFilePath, {
		idempotencyKey,
		channel: "telegram",
		chatId: target.chatId,
		telegramChatId,
		telegramUpdateId,
		telegramMessageId,
		direction: "outbound",
		source: outboundSource,
		text: outboundText,
	});
}

export async function startTelegramPollingBot(
	runtime: ChatSessionRuntime<AgentSession>,
	config: ResolvedTelegramPollingBotConfig,
	chatExecutorOrDependencies:
		| ChatExecutor
		| TelegramServiceDependencies = new InMemoryChatExecutor(),
	dependenciesArg: TelegramServiceDependencies = defaultTelegramServiceDependencies
): Promise<RunningTelegramPollingBot> {
	const chatExecutor =
		"run" in chatExecutorOrDependencies
			? chatExecutorOrDependencies
			: new InMemoryChatExecutor();
	const dependencies =
		"run" in chatExecutorOrDependencies
			? dependenciesArg
			: chatExecutorOrDependencies;
	const bot = dependencies.createBot(config.token);

	bot.onError((error: unknown) => {
		const normalizedError = normalizeUnknownError(error);
		queueMicrotask(() => {
			throw normalizedError;
		});
	});

	bot.onTextMessage(async (context: TelegramTextMessageContext) => {
		const telegramChatId = normalizeTelegramChatId(context.chat.id);
		const queueKey =
			config.chatRoutes[telegramChatId]?.chatId ?? telegramChatId;
		await chatExecutor.run(queueKey, async () => {
			try {
				await handleTelegramTextMessage(
					runtime,
					config.chatRoutes,
					context
				);
			} catch (error: unknown) {
				await replyTextInChunks(
					context,
					formatUserFacingErrorMessage(error)
				);
			}
		});
	});

	const done = bot.start().finally(() => {
		for (const target of Object.values(config.chatRoutes)) {
			runtime.disposeSession(target.chatId);
		}
	});

	return {
		done,
		async stop(): Promise<void> {
			await bot.stop();
		},
	};
}
