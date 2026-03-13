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
import { PiChatHandler, type ChatHandler } from "@phi/services/chat-handler";
import { ServiceRoutes } from "@phi/services/routes";
import {
	startTelegramEndpoint as startTelegramService,
	type ResolvedTelegramEndpointConfig,
	type RunningTelegramEndpoint,
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
	createRoutes(): ServiceRoutes;
	createChatHandler(params: {
		chatId: string;
		phiConfig: PhiConfig;
		runtime: ChatSessionRuntime<AgentSession>;
		chatExecutor: ChatExecutor;
		routes: ServiceRoutes;
	}): ChatHandler;
	startTelegramEndpoint(
		routes: ServiceRoutes,
		config: ResolvedTelegramEndpointConfig
	): Promise<RunningTelegramEndpoint>;
	startCronRuntime(
		phiConfig: PhiConfig,
		chatConfigs: ResolvedCronChatServiceConfig[],
		reloadRegistry: ChatReloadRegistry,
		routes: ServiceRoutes
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
	createRoutes(): ServiceRoutes {
		return new ServiceRoutes();
	},
	createChatHandler(params): ChatHandler {
		return new PiChatHandler(params);
	},
	startTelegramEndpoint(
		routes: ServiceRoutes,
		config: ResolvedTelegramEndpointConfig
	): Promise<RunningTelegramEndpoint> {
		return startTelegramService(routes, config);
	},
	startCronRuntime(
		phiConfig: PhiConfig,
		chatConfigs: ResolvedCronChatServiceConfig[],
		reloadRegistry: ChatReloadRegistry,
		routes: ServiceRoutes
	): Promise<RunningCronService> {
		return startCronService({
			phiConfig,
			chatConfigs,
			reloadRegistry,
			routes,
		});
	},
};

function buildTelegramEndpointConfigs(
	chatConfigs: ResolvedTelegramChatServiceConfig[]
): ResolvedTelegramEndpointConfig[] {
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

function collectServiceChatIds(params: {
	telegramChats: ResolvedTelegramChatServiceConfig[];
	cronChats: ResolvedCronChatServiceConfig[];
}): string[] {
	const chatIds: string[] = [];
	const seenChatIds = new Set<string>();
	for (const chatConfig of params.cronChats) {
		if (seenChatIds.has(chatConfig.chatId)) {
			continue;
		}
		seenChatIds.add(chatConfig.chatId);
		chatIds.push(chatConfig.chatId);
	}
	for (const chatConfig of params.telegramChats) {
		if (seenChatIds.has(chatConfig.chatId)) {
			continue;
		}
		seenChatIds.add(chatConfig.chatId);
		chatIds.push(chatConfig.chatId);
	}
	return chatIds;
}

async function stopAllServices(services: RunningServicePart[]): Promise<void> {
	await Promise.allSettled(
		services.map(async (service) => {
			await service.stop();
		})
	);
}

async function disposeAllHandlers(handlers: ChatHandler[]): Promise<void> {
	for (const handler of handlers) {
		handler.dispose();
	}
}

function unregisterAll(unregisters: Array<() => void>): void {
	for (const unregister of unregisters) {
		unregister();
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
	const routes = resolvedDependencies.createRoutes();
	const serviceChatIds = collectServiceChatIds({
		telegramChats,
		cronChats,
	});
	log.info("service.command.starting", {
		telegramChatCount: telegramChats.length,
		cronChatCount: cronChats.length,
		serviceChatCount: serviceChatIds.length,
	});
	const telegramEndpointConfigs = buildTelegramEndpointConfigs(telegramChats);

	const runningServices: RunningServicePart[] = [];
	const chatHandlers: ChatHandler[] = [];
	const unregisterHandlers: Array<() => void> = [];
	try {
		for (const chatId of serviceChatIds) {
			const handler = resolvedDependencies.createChatHandler({
				chatId,
				phiConfig,
				runtime,
				chatExecutor,
				routes,
			});
			chatHandlers.push(handler);
			unregisterHandlers.push(
				routes.registerChatHandler(chatId, handler)
			);
			unregisterHandlers.push(
				reloadRegistry.register(chatId, async () => {
					handler.invalidate();
					return ["chat-handler"];
				})
			);
		}

		for (const endpointConfig of telegramEndpointConfigs) {
			log.info("service.telegram.starting", {
				routeCount: Object.keys(endpointConfig.chatRoutes).length,
			});
			const runningEndpoint =
				await resolvedDependencies.startTelegramEndpoint(
					routes,
					endpointConfig
				);
			runningServices.push(runningEndpoint);
			log.info("service.telegram.started", {
				routeCount: Object.keys(endpointConfig.chatRoutes).length,
			});
		}

		const cronRuntime = await resolvedDependencies.startCronRuntime(
			phiConfig,
			cronChats,
			reloadRegistry,
			routes
		);
		runningServices.push(cronRuntime);
		log.info("service.cron.started", {
			cronChatCount: cronChats.length,
		});
		log.info("service.command.started", {
			runningServiceCount: runningServices.length,
			chatHandlerCount: chatHandlers.length,
		});
	} catch (error: unknown) {
		log.error("service.command.start_failed", {
			err: error instanceof Error ? error : new Error(String(error)),
			runningServiceCount: runningServices.length,
			chatHandlerCount: chatHandlers.length,
		});
		await stopAllServices(runningServices);
		unregisterAll(unregisterHandlers);
		await disposeAllHandlers(chatHandlers);
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
			chatHandlerCount: chatHandlers.length,
		});
		await stopAllServices(runningServices);
		unregisterAll(unregisterHandlers);
		await disposeAllHandlers(chatHandlers);
		log.info("service.command.stopped", {
			runningServiceCount: runningServices.length,
			chatHandlerCount: chatHandlers.length,
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
