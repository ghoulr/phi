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
import { getPhiLogger } from "@phi/core/logger";
import { ChatReloadRegistry } from "@phi/core/reload";
import type { ChatSessionRuntime } from "@phi/core/runtime";
import { startCronService, type RunningCronService } from "@phi/cron/service";
import { PhiRouteDeliveryRegistry } from "@phi/messaging/route-delivery";
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

const log = getPhiLogger("service");

export interface ServiceCommandDependencies {
	resolveTelegramChats(
		phiConfig: PhiConfig
	): ResolvedTelegramChatServiceConfig[];
	resolveCronChats(phiConfig: PhiConfig): ResolvedCronChatServiceConfig[];
	createChatExecutor(): ChatExecutor;
	createReloadRegistry(): ChatReloadRegistry;
	createDeliveryRegistry(): PhiRouteDeliveryRegistry;
	startTelegramBot(
		runtime: ChatSessionRuntime<AgentSession>,
		config: ResolvedTelegramPollingBotConfig,
		deliveryRegistry: PhiRouteDeliveryRegistry
	): Promise<RunningTelegramPollingBot>;
	startCronRuntime(
		runtime: ChatSessionRuntime<AgentSession>,
		phiConfig: PhiConfig,
		chatConfigs: ResolvedCronChatServiceConfig[],
		chatExecutor: ChatExecutor,
		reloadRegistry: ChatReloadRegistry,
		deliveryRegistry: PhiRouteDeliveryRegistry
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
	createDeliveryRegistry(): PhiRouteDeliveryRegistry {
		return new PhiRouteDeliveryRegistry();
	},
	startTelegramBot(
		runtime: ChatSessionRuntime<AgentSession>,
		config: ResolvedTelegramPollingBotConfig,
		deliveryRegistry: PhiRouteDeliveryRegistry
	): Promise<RunningTelegramPollingBot> {
		return startTelegramPollingBot(
			runtime,
			config,
			undefined,
			deliveryRegistry
		);
	},
	startCronRuntime(
		runtime: ChatSessionRuntime<AgentSession>,
		phiConfig: PhiConfig,
		chatConfigs: ResolvedCronChatServiceConfig[],
		chatExecutor: ChatExecutor,
		reloadRegistry: ChatReloadRegistry,
		deliveryRegistry: PhiRouteDeliveryRegistry
	): Promise<RunningCronService> {
		return startCronService({
			runtime,
			phiConfig,
			chatConfigs,
			chatExecutor,
			reloadRegistry,
			deliveryRegistry,
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
	const deliveryRegistry = resolvedDependencies.createDeliveryRegistry();
	log.info("service.command.starting", {
		telegramChatCount: telegramChats.length,
		cronChatCount: cronChats.length,
	});
	const telegramBotConfigs = buildTelegramBotConfigs(telegramChats);

	const runningServices: RunningServicePart[] = [];
	try {
		const cronRuntime = await resolvedDependencies.startCronRuntime(
			runtime,
			phiConfig,
			cronChats,
			chatExecutor,
			reloadRegistry,
			deliveryRegistry
		);
		runningServices.push(cronRuntime);
		log.info("service.cron.started", {
			cronChatCount: cronChats.length,
		});

		for (const botConfig of telegramBotConfigs) {
			log.info("service.telegram.starting", {
				routeCount: Object.keys(botConfig.chatRoutes).length,
			});
			const runningBot = await resolvedDependencies.startTelegramBot(
				runtime,
				botConfig,
				deliveryRegistry
			);
			runningServices.push(runningBot);
			log.info("service.telegram.started", {
				routeCount: Object.keys(botConfig.chatRoutes).length,
			});
		}
		log.info("service.command.started", {
			runningServiceCount: runningServices.length,
		});
	} catch (error: unknown) {
		log.error("service.command.start_failed", {
			err: error instanceof Error ? error : new Error(String(error)),
			runningServiceCount: runningServices.length,
		});
		await stopAllServices(runningServices);
		throw error;
	}

	let stopping = false;
	const stopService = async (): Promise<void> => {
		if (stopping) {
			return;
		}
		stopping = true;
		log.info("service.command.stopping", {
			runningServiceCount: runningServices.length,
		});
		await stopAllServices(runningServices);
		log.info("service.command.stopped", {
			runningServiceCount: runningServices.length,
		});
	};

	const stopHandler = (): void => {
		log.info("service.command.signal_received", {
			signal: "shutdown",
		});
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
