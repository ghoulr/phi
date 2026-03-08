import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	InMemoryChatExecutor,
	type ChatExecutor,
} from "@phi/core/chat-executor";
import {
	collectTelegramChatServiceConfigs,
	resolveCronChatServiceConfigs,
	type PhiConfig,
	type ResolvedCronChatServiceConfig,
	type ResolvedTelegramChatServiceConfig,
} from "@phi/core/config";
import { ChatReloadRegistry } from "@phi/core/reload";
import type { ChatSessionRuntime } from "@phi/core/runtime";
import { startCronService, type RunningCronService } from "@phi/cron/service";
import {
	startTelegramPollingBot,
	type ResolvedTelegramPollingBotConfig,
	type RunningTelegramPollingBot,
	type TelegramRouteTarget,
} from "@phi/services/telegram";

interface RunningServicePart {
	done: Promise<void>;
	stop(): Promise<void>;
}

export interface ServiceCommandDependencies {
	resolveTelegramChats(
		phiConfig: PhiConfig
	): ResolvedTelegramChatServiceConfig[];
	resolveCronChats(phiConfig: PhiConfig): ResolvedCronChatServiceConfig[];
	createChatExecutor(): ChatExecutor;
	createReloadRegistry(): ChatReloadRegistry;
	startTelegramBot(
		runtime: ChatSessionRuntime<AgentSession>,
		config: ResolvedTelegramPollingBotConfig,
		chatExecutor: ChatExecutor
	): Promise<RunningTelegramPollingBot>;
	startCronRuntime(
		runtime: ChatSessionRuntime<AgentSession>,
		phiConfig: PhiConfig,
		chatConfigs: ResolvedCronChatServiceConfig[],
		chatExecutor: ChatExecutor,
		reloadRegistry: ChatReloadRegistry
	): Promise<RunningCronService>;
}

const defaultServiceCommandDependencies: ServiceCommandDependencies = {
	resolveTelegramChats(
		phiConfig: PhiConfig
	): ResolvedTelegramChatServiceConfig[] {
		return collectTelegramChatServiceConfigs(phiConfig);
	},
	resolveCronChats(phiConfig: PhiConfig): ResolvedCronChatServiceConfig[] {
		return resolveCronChatServiceConfigs(phiConfig);
	},
	createChatExecutor(): ChatExecutor {
		return new InMemoryChatExecutor();
	},
	createReloadRegistry(): ChatReloadRegistry {
		return new ChatReloadRegistry();
	},
	startTelegramBot(
		runtime: ChatSessionRuntime<AgentSession>,
		config: ResolvedTelegramPollingBotConfig,
		chatExecutor: ChatExecutor
	): Promise<RunningTelegramPollingBot> {
		return startTelegramPollingBot(runtime, config, chatExecutor);
	},
	startCronRuntime(
		runtime: ChatSessionRuntime<AgentSession>,
		phiConfig: PhiConfig,
		chatConfigs: ResolvedCronChatServiceConfig[],
		chatExecutor: ChatExecutor,
		reloadRegistry: ChatReloadRegistry
	): Promise<RunningCronService> {
		return startCronService({
			runtime,
			phiConfig,
			chatConfigs,
			chatExecutor,
			reloadRegistry,
		});
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

async function stopAllServices(services: RunningServicePart[]): Promise<void> {
	await Promise.allSettled(
		services.map(async (service) => {
			await service.stop();
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
	dependencies: Partial<ServiceCommandDependencies> = {}
): Promise<void> {
	const resolvedDependencies: ServiceCommandDependencies = {
		...defaultServiceCommandDependencies,
		...dependencies,
	};
	const telegramChats = resolvedDependencies.resolveTelegramChats(phiConfig);
	const cronChats = resolvedDependencies.resolveCronChats(phiConfig);
	const chatExecutor = resolvedDependencies.createChatExecutor();
	const reloadRegistry = resolvedDependencies.createReloadRegistry();
	await printSystemPromptDebugOutput(runtime, telegramChats);
	const telegramBotConfigs = buildTelegramBotConfigs(telegramChats);

	const runningServices: RunningServicePart[] = [];
	try {
		const cronRuntime = await resolvedDependencies.startCronRuntime(
			runtime,
			phiConfig,
			cronChats,
			chatExecutor,
			reloadRegistry
		);
		runningServices.push(cronRuntime);

		for (const botConfig of telegramBotConfigs) {
			const runningBot = await resolvedDependencies.startTelegramBot(
				runtime,
				botConfig,
				chatExecutor
			);
			runningServices.push(runningBot);
		}
	} catch (error: unknown) {
		await stopAllServices(runningServices);
		throw error;
	}

	let stopping = false;
	const stopService = async (): Promise<void> => {
		if (stopping) {
			return;
		}
		stopping = true;
		await stopAllServices(runningServices);
	};

	const stopHandler = (): void => {
		void stopService();
	};

	process.once("SIGINT", stopHandler);
	process.once("SIGTERM", stopHandler);

	try {
		await Promise.all(runningServices.map((service) => service.done));
	} finally {
		process.off("SIGINT", stopHandler);
		process.off("SIGTERM", stopHandler);
		await stopService();
	}
}
