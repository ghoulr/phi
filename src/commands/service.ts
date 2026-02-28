import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	startTelegramPollingBot,
	type ResolvedTelegramPollingBotConfig,
	type RunningTelegramPollingBot,
} from "@phi/commands/telegram";
import {
	resolveTelegramChatServiceConfigs,
	type PhiConfig,
	type ResolvedTelegramChatServiceConfig,
} from "@phi/core/config";
import type { AgentConversationRuntime } from "@phi/core/runtime";

export interface ServiceCommandDependencies {
	resolveTelegramChats(
		phiConfig: PhiConfig
	): ResolvedTelegramChatServiceConfig[];
	startTelegramBot(
		runtime: AgentConversationRuntime<AgentSession>,
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
		runtime: AgentConversationRuntime<AgentSession>,
		config: ResolvedTelegramPollingBotConfig
	): Promise<RunningTelegramPollingBot> {
		return startTelegramPollingBot(runtime, config);
	},
};

function buildTelegramBotConfigs(
	chatConfigs: ResolvedTelegramChatServiceConfig[]
): ResolvedTelegramPollingBotConfig[] {
	const groupedRoutes = new Map<string, Record<string, string>>();

	for (const chatConfig of chatConfigs) {
		const existingRoutes = groupedRoutes.get(chatConfig.token);
		if (existingRoutes) {
			existingRoutes[chatConfig.chatId] = chatConfig.agentId;
			continue;
		}
		groupedRoutes.set(chatConfig.token, {
			[chatConfig.chatId]: chatConfig.agentId,
		});
	}

	return Array.from(groupedRoutes.entries()).map(
		([token, chatAgentRoutes]) => ({
			token,
			chatAgentRoutes,
		})
	);
}

async function stopAllBots(bots: RunningTelegramPollingBot[]): Promise<void> {
	await Promise.allSettled(
		bots.map(async (bot) => {
			await bot.stop();
		})
	);
}

export async function runServiceCommand(
	runtime: AgentConversationRuntime<AgentSession>,
	phiConfig: PhiConfig,
	dependencies: ServiceCommandDependencies = defaultServiceCommandDependencies
): Promise<void> {
	const telegramChats = dependencies.resolveTelegramChats(phiConfig);
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
