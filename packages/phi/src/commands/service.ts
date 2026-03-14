import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	InMemorySessionExecutor,
	type SessionExecutor,
} from "@phi/core/session-executor";
import {
	collectTelegramSessionServiceConfigs,
	resolveCronSessionServiceConfigs,
	type PhiConfig,
	type ResolvedCronSessionServiceConfig,
	type ResolvedTelegramSessionServiceConfig,
} from "@phi/core/config";
import { getPhiLogger } from "@phi/core/logger";
import { ChatReloadRegistry } from "@phi/core/reload";
import type { SessionRuntime } from "@phi/core/runtime";
import { startCronService, type RunningCronService } from "@phi/cron/service";
import { PiSessionRuntime, type Session } from "@phi/services/session";
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
	resolveTelegramSessions(
		phiConfig: PhiConfig
	): ResolvedTelegramSessionServiceConfig[];
	resolveCronSessions(
		phiConfig: PhiConfig
	): ResolvedCronSessionServiceConfig[];
	createSessionExecutor(): SessionExecutor;
	createReloadRegistry(): ChatReloadRegistry;
	createRoutes(): ServiceRoutes;
	createSession(params: {
		sessionId: string;
		chatId: string;
		phiConfig: PhiConfig;
		runtime: SessionRuntime<AgentSession>;
		sessionExecutor: SessionExecutor;
		routes: ServiceRoutes;
		reloadRegistry: ChatReloadRegistry;
	}): Session;
	startTelegramEndpoint(
		routes: ServiceRoutes,
		config: ResolvedTelegramEndpointConfig
	): Promise<RunningTelegramEndpoint>;
	startCronRuntime(
		phiConfig: PhiConfig,
		sessionConfigs: ResolvedCronSessionServiceConfig[],
		reloadRegistry: ChatReloadRegistry,
		routes: ServiceRoutes
	): Promise<RunningCronService>;
}

const defaultServiceCommandDependencies: ServiceCommandDependencies = {
	resolveTelegramSessions(
		phiConfig: PhiConfig
	): ResolvedTelegramSessionServiceConfig[] {
		return collectTelegramSessionServiceConfigs(phiConfig);
	},
	resolveCronSessions(
		phiConfig: PhiConfig
	): ResolvedCronSessionServiceConfig[] {
		return resolveCronSessionServiceConfigs(phiConfig);
	},
	createSessionExecutor(): SessionExecutor {
		return new InMemorySessionExecutor();
	},
	createReloadRegistry(): ChatReloadRegistry {
		return new ChatReloadRegistry();
	},
	createRoutes(): ServiceRoutes {
		return new ServiceRoutes();
	},
	createSession(params): Session {
		return new PiSessionRuntime(params);
	},
	startTelegramEndpoint(
		routes: ServiceRoutes,
		config: ResolvedTelegramEndpointConfig
	): Promise<RunningTelegramEndpoint> {
		return startTelegramService(routes, config);
	},
	startCronRuntime(
		phiConfig: PhiConfig,
		sessionConfigs: ResolvedCronSessionServiceConfig[],
		reloadRegistry: ChatReloadRegistry,
		routes: ServiceRoutes
	): Promise<RunningCronService> {
		return startCronService({
			phiConfig,
			sessionConfigs,
			reloadRegistry,
			routes,
		});
	},
};

function buildTelegramEndpointConfigs(
	sessionConfigs: ResolvedTelegramSessionServiceConfig[]
): ResolvedTelegramEndpointConfig[] {
	const groupedRoutes = new Map<
		string,
		Record<string, TelegramRouteTarget>
	>();

	for (const sessionConfig of sessionConfigs) {
		let routes = groupedRoutes.get(sessionConfig.token);
		if (!routes) {
			routes = {};
			groupedRoutes.set(sessionConfig.token, routes);
		}

		if (routes[sessionConfig.telegramChatId]) {
			throw new Error(
				`Duplicate telegram route for token ${sessionConfig.token} and chat id ${sessionConfig.telegramChatId}`
			);
		}
		routes[sessionConfig.telegramChatId] = {
			sessionId: sessionConfig.sessionId,
			chatId: sessionConfig.chatId,
			workspace: sessionConfig.workspace,
		};
	}

	return Array.from(groupedRoutes.entries()).map(([token, chatRoutes]) => ({
		token,
		chatRoutes,
	}));
}

function collectServiceSessions(params: {
	telegramSessions: ResolvedTelegramSessionServiceConfig[];
	cronSessions: ResolvedCronSessionServiceConfig[];
}): Array<{ sessionId: string; chatId: string }> {
	const sessions: Array<{ sessionId: string; chatId: string }> = [];
	const seenSessionIds = new Set<string>();
	for (const sessionConfig of params.cronSessions) {
		if (seenSessionIds.has(sessionConfig.sessionId)) {
			continue;
		}
		seenSessionIds.add(sessionConfig.sessionId);
		sessions.push({
			sessionId: sessionConfig.sessionId,
			chatId: sessionConfig.chatId,
		});
	}
	for (const sessionConfig of params.telegramSessions) {
		if (seenSessionIds.has(sessionConfig.sessionId)) {
			continue;
		}
		seenSessionIds.add(sessionConfig.sessionId);
		sessions.push({
			sessionId: sessionConfig.sessionId,
			chatId: sessionConfig.chatId,
		});
	}
	return sessions;
}

async function stopAllServices(services: RunningServicePart[]): Promise<void> {
	await Promise.allSettled(
		services.map(async (service) => {
			await service.stop();
		})
	);
}

async function disposeAllSessions(sessions: Session[]): Promise<void> {
	for (const session of sessions) {
		session.dispose();
	}
}

function unregisterAll(unregisters: Array<() => void>): void {
	for (const unregister of unregisters) {
		unregister();
	}
}

export async function runServiceCommand(
	runtime: SessionRuntime<AgentSession>,
	phiConfig: PhiConfig,
	dependencies: Partial<ServiceCommandDependencies> = {}
): Promise<void> {
	const resolvedDependencies: ServiceCommandDependencies = {
		...defaultServiceCommandDependencies,
		...dependencies,
	};
	const telegramSessions =
		resolvedDependencies.resolveTelegramSessions(phiConfig);
	const cronSessions = resolvedDependencies.resolveCronSessions(phiConfig);
	const sessionExecutor = resolvedDependencies.createSessionExecutor();
	const reloadRegistry = resolvedDependencies.createReloadRegistry();
	const routes = resolvedDependencies.createRoutes();
	const serviceSessions = collectServiceSessions({
		telegramSessions,
		cronSessions,
	});
	log.info("service.command.starting", {
		telegramSessionCount: telegramSessions.length,
		cronSessionCount: cronSessions.length,
		serviceSessionCount: serviceSessions.length,
	});
	const telegramEndpointConfigs =
		buildTelegramEndpointConfigs(telegramSessions);

	const runningServices: RunningServicePart[] = [];
	const sessions: Session[] = [];
	const unregisterHandlers: Array<() => void> = [];
	try {
		for (const serviceSession of serviceSessions) {
			const session = resolvedDependencies.createSession({
				sessionId: serviceSession.sessionId,
				chatId: serviceSession.chatId,
				phiConfig,
				runtime,
				sessionExecutor,
				routes,
				reloadRegistry,
			});
			sessions.push(session);
			unregisterHandlers.push(
				routes.registerSession(serviceSession.sessionId, session)
			);
			unregisterHandlers.push(
				reloadRegistry.register(serviceSession.chatId, {
					validate: () => session.validateReload(),
					apply: async () => {
						session.invalidate();
						return ["session"];
					},
				})
			);
		}

		for (const sessionConfig of cronSessions) {
			unregisterHandlers.push(
				routes.registerCronRoute(
					sessionConfig.chatId,
					sessionConfig.sessionId
				)
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
			cronSessions,
			reloadRegistry,
			routes
		);
		runningServices.push(cronRuntime);
		log.info("service.cron.started", {
			cronSessionCount: cronSessions.length,
		});
		log.info("service.command.started", {
			runningServiceCount: runningServices.length,
			sessionCount: sessions.length,
		});
	} catch (error: unknown) {
		log.error("service.command.start_failed", {
			err: error instanceof Error ? error : new Error(String(error)),
			runningServiceCount: runningServices.length,
			sessionCount: sessions.length,
		});
		await stopAllServices(runningServices);
		unregisterAll(unregisterHandlers);
		await disposeAllSessions(sessions);
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
			sessionCount: sessions.length,
		});
		await stopAllServices(runningServices);
		unregisterAll(unregisterHandlers);
		await disposeAllSessions(sessions);
		log.info("service.command.stopped", {
			runningServiceCount: runningServices.length,
			sessionCount: sessions.length,
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
