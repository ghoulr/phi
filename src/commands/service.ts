import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	startTelegramPollingBot,
	type ResolvedTelegramPollingBotConfig,
	type RunningTelegramPollingBot,
	type TelegramRouteTarget,
} from "@phi/services/telegram";
import {
	resolveTelegramChatServiceConfigs,
	type PhiConfig,
	type ResolvedTelegramChatServiceConfig,
} from "@phi/core/config";
import type { ChatSessionRuntime } from "@phi/core/runtime";

export interface ServiceCommandDependencies {
	resolveTelegramChats(
		phiConfig: PhiConfig
	): ResolvedTelegramChatServiceConfig[];
	startTelegramBot(
		runtime: ChatSessionRuntime<AgentSession>,
		config: ResolvedTelegramPollingBotConfig
	): Promise<RunningTelegramPollingBot>;
}

const defaultServiceCommandDependencies: ServiceCommandDependencies = {
	resolveTelegramChats(
		phiConfig: PhiConfig
	): ResolvedTelegramChatServiceConfig[] {
		return resolveTelegramChatServiceConfigs(phiConfig);
	},
	startTelegramBot(
		runtime: ChatSessionRuntime<AgentSession>,
		config: ResolvedTelegramPollingBotConfig
	): Promise<RunningTelegramPollingBot> {
		return startTelegramPollingBot(runtime, config);
	},
};

function buildTelegramBotConfigs(
	chatConfigs: ResolvedTelegramChatServiceConfig[]
): ResolvedTelegramPollingBotConfig[] {
	const groupedRoutes = new Map<
		string,
		Record<string, TelegramRouteTarget>
	>();

	for (const chatConfig of chatConfigs) {
		let routes = groupedRoutes.get(chatConfig.token);
		if (!routes) {
			routes = {};
			groupedRoutes.set(chatConfig.token, routes);
		}

		if (routes[chatConfig.telegramChatId]) {
			throw new Error(
				`Duplicate telegram route for token ${chatConfig.token} and chat id ${chatConfig.telegramChatId}`
			);
		}
		routes[chatConfig.telegramChatId] = {
			chatId: chatConfig.chatId,
			workspace: chatConfig.workspace,
		};
	}

	return Array.from(groupedRoutes.entries()).map(([token, chatRoutes]) => ({
		token,
		chatRoutes,
	}));
}

async function stopAllBots(bots: RunningTelegramPollingBot[]): Promise<void> {
	await Promise.allSettled(
		bots.map(async (bot) => {
			await bot.stop();
		})
	);
}

async function printSystemPromptDebugOutput(
	runtime: ChatSessionRuntime<AgentSession>,
	chatConfigs: ResolvedTelegramChatServiceConfig[]
): Promise<void> {
	const uniqueChatIds = Array.from(
		new Set(chatConfigs.map((chatConfig) => chatConfig.chatId))
	);
	for (const chatId of uniqueChatIds) {
		const session = await runtime.getOrCreateSession(chatId);
		console.debug(
			`[phi][debug] generated system prompt for chat ${chatId}:\n${session.systemPrompt}`
		);
	}
}

export async function runServiceCommand(
	runtime: ChatSessionRuntime<AgentSession>,
	phiConfig: PhiConfig,
	dependencies: ServiceCommandDependencies = defaultServiceCommandDependencies
): Promise<void> {
	const telegramChats = dependencies.resolveTelegramChats(phiConfig);
	await printSystemPromptDebugOutput(runtime, telegramChats);
	const telegramBotConfigs = buildTelegramBotConfigs(telegramChats);

	const runningBots: RunningTelegramPollingBot[] = [];
	try {
		for (const botConfig of telegramBotConfigs) {
			const runningBot = await dependencies.startTelegramBot(
				runtime,
				botConfig
			);
			runningBots.push(runningBot);
		}
	} catch (error: unknown) {
		await stopAllBots(runningBots);
		throw error;
	}

	let stopping = false;
	const stopService = async (): Promise<void> => {
		if (stopping) {
			return;
		}
		stopping = true;
		await stopAllBots(runningBots);
	};

	const stopHandler = (): void => {
		void stopService();
	};

	process.once("SIGINT", stopHandler);
	process.once("SIGTERM", stopHandler);

	try {
		await Promise.all(runningBots.map((bot) => bot.done));
	} finally {
		process.off("SIGINT", stopHandler);
		process.off("SIGTERM", stopHandler);
		await stopService();
	}
}
