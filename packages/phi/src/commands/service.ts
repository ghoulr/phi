import type { AgentSession } from "@mariozechner/pi-coding-agent";

import {
	InMemorySessionExecutor,
	type SessionExecutor,
} from "@phi/core/session-executor";
import {
	collectFeishuSessionServiceConfigs,
	resolveCronSessionServiceConfigs,
	type PhiConfig,
	type ResolvedCronSessionServiceConfig,
	type ResolvedFeishuSessionServiceConfig,
	type ResolvedTelegramSessionServiceConfig,
} from "@phi/core/config";
import {
	bindTelegramChatRoute,
	createTelegramRouteRegistry,
	resolveTelegramSessionServiceConfigs,
	resolveTelegramWildcardRouteConfigs,
	type ResolvedTelegramWildcardRouteConfig,
} from "@phi/core/telegram-routes";
import { getPhiLogger } from "@phi/core/logger";
import { ChatReloadRegistry } from "@phi/core/reload";
import type { SessionRuntime } from "@phi/core/runtime";
import { startCronService, type RunningCronService } from "@phi/cron/service";
import { PiSessionRuntime, type Session } from "@phi/services/session";
import { ServiceRoutes } from "@phi/services/routes";
import {
	startFeishuEndpoint as startFeishuService,
	type FeishuRouteTarget,
	type ResolvedFeishuEndpointConfig,
	type RunningFeishuEndpoint,
} from "@phi/services/feishu";
import {
	startTelegramEndpoint as startTelegramService,
	type ResolvedTelegramEndpointConfig,
	type RunningTelegramEndpoint,
	type TelegramEndpointDependencies,
	type TelegramRouteTarget,
	type TelegramWildcardRouteTarget,
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
	resolveFeishuSessions(
		phiConfig: PhiConfig
	): ResolvedFeishuSessionServiceConfig[];
	resolveTelegramWildcardRoutes(
		phiConfig: PhiConfig
	): ResolvedTelegramWildcardRouteConfig[];
	resolveCronSessions(
		phiConfig: PhiConfig
	): ResolvedCronSessionServiceConfig[];
	createSessionExecutor(): SessionExecutor;
	createReloadRegistry(): ChatReloadRegistry;
	createRoutes(): ServiceRoutes;
	createSession(params: {
		sessionId: string;
		configSessionId?: string;
		chatId: string;
		phiConfig: PhiConfig;
		runtime: SessionRuntime<AgentSession>;
		sessionExecutor: SessionExecutor;
		routes: ServiceRoutes;
		reloadRegistry: ChatReloadRegistry;
	}): Session;
	startTelegramEndpoint(
		routes: ServiceRoutes,
		config: ResolvedTelegramEndpointConfig,
		dependencies?: TelegramEndpointDependencies
	): Promise<RunningTelegramEndpoint>;
	startFeishuEndpoint(
		routes: ServiceRoutes,
		config: ResolvedFeishuEndpointConfig
	): Promise<RunningFeishuEndpoint>;
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
		return resolveTelegramSessionServiceConfigs(phiConfig);
	},
	resolveFeishuSessions(
		phiConfig: PhiConfig
	): ResolvedFeishuSessionServiceConfig[] {
		return collectFeishuSessionServiceConfigs(phiConfig);
	},
	resolveTelegramWildcardRoutes(
		phiConfig: PhiConfig
	): ResolvedTelegramWildcardRouteConfig[] {
		return resolveTelegramWildcardRouteConfigs(phiConfig);
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
		config: ResolvedTelegramEndpointConfig,
		dependencies?: TelegramEndpointDependencies
	): Promise<RunningTelegramEndpoint> {
		return startTelegramService(routes, config, dependencies);
	},
	startFeishuEndpoint(
		routes: ServiceRoutes,
		config: ResolvedFeishuEndpointConfig
	): Promise<RunningFeishuEndpoint> {
		return startFeishuService(routes, config);
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

function buildTelegramEndpointConfigs(params: {
	sessionConfigs: ResolvedTelegramSessionServiceConfig[];
	wildcardConfigs: ResolvedTelegramWildcardRouteConfig[];
}): ResolvedTelegramEndpointConfig[] {
	const groupedRoutes = new Map<
		string,
		{
			chatRoutes: Record<string, TelegramRouteTarget>;
			wildcardRoute?: TelegramWildcardRouteTarget;
		}
	>();

	for (const sessionConfig of params.sessionConfigs) {
		let groupedConfig = groupedRoutes.get(sessionConfig.token);
		if (!groupedConfig) {
			groupedConfig = { chatRoutes: {} };
			groupedRoutes.set(sessionConfig.token, groupedConfig);
		}

		if (groupedConfig.chatRoutes[sessionConfig.telegramChatId]) {
			throw new Error(
				`Duplicate telegram route for token ${sessionConfig.token} and chat id ${sessionConfig.telegramChatId}`
			);
		}
		groupedConfig.chatRoutes[sessionConfig.telegramChatId] = {
			sessionId: sessionConfig.sessionId,
			chatId: sessionConfig.chatId,
			workspace: sessionConfig.workspace,
		};
	}

	for (const wildcardConfig of params.wildcardConfigs) {
		let groupedConfig = groupedRoutes.get(wildcardConfig.token);
		if (!groupedConfig) {
			groupedConfig = { chatRoutes: {} };
			groupedRoutes.set(wildcardConfig.token, groupedConfig);
		}
		if (groupedConfig.wildcardRoute) {
			throw new Error(
				`Duplicate telegram wildcard route for token ${wildcardConfig.token}`
			);
		}
		groupedConfig.wildcardRoute = {
			configSessionId: wildcardConfig.configSessionId,
			chatId: wildcardConfig.chatId,
			workspace: wildcardConfig.workspace,
		};
	}

	return Array.from(groupedRoutes.entries()).map(
		([token, { chatRoutes, wildcardRoute }]) => ({
			token,
			chatRoutes,
			wildcardRoute,
		})
	);
}

function buildFeishuEndpointConfigs(
	sessionConfigs: ResolvedFeishuSessionServiceConfig[]
): ResolvedFeishuEndpointConfig[] {
	const groupedRoutes = new Map<
		string,
		{
			appId: string;
			appSecret: string;
			chatRoutes: Record<string, FeishuRouteTarget>;
		}
	>();

	for (const sessionConfig of sessionConfigs) {
		const configKey = `${sessionConfig.appId}\u0000${sessionConfig.appSecret}`;
		let groupedConfig = groupedRoutes.get(configKey);
		if (!groupedConfig) {
			groupedConfig = {
				appId: sessionConfig.appId,
				appSecret: sessionConfig.appSecret,
				chatRoutes: {},
			};
			groupedRoutes.set(configKey, groupedConfig);
		}

		if (groupedConfig.chatRoutes[sessionConfig.feishuChatId]) {
			throw new Error(
				`Duplicate feishu route for app ${sessionConfig.appId} and chat id ${sessionConfig.feishuChatId}`
			);
		}
		groupedConfig.chatRoutes[sessionConfig.feishuChatId] = {
			sessionId: sessionConfig.sessionId,
			chatId: sessionConfig.chatId,
			workspace: sessionConfig.workspace,
		};
	}

	return Array.from(groupedRoutes.values());
}

function collectServiceSessions(
	...groups: Array<
		Array<{
			sessionId: string;
			configSessionId?: string;
			chatId: string;
		}>
	>
): Array<{ sessionId: string; configSessionId?: string; chatId: string }> {
	const sessions: Array<{
		sessionId: string;
		configSessionId?: string;
		chatId: string;
	}> = [];
	const seenSessionIds = new Set<string>();
	for (const group of groups) {
		for (const sessionConfig of group) {
			if (seenSessionIds.has(sessionConfig.sessionId)) {
				continue;
			}
			seenSessionIds.add(sessionConfig.sessionId);
			sessions.push({
				sessionId: sessionConfig.sessionId,
				configSessionId: sessionConfig.configSessionId,
				chatId: sessionConfig.chatId,
			});
		}
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
	const telegramRouteRegistry =
		dependencies.resolveTelegramSessions === undefined &&
		dependencies.resolveTelegramWildcardRoutes === undefined
			? createTelegramRouteRegistry(phiConfig)
			: undefined;
	const telegramSessions = telegramRouteRegistry
		? telegramRouteRegistry.resolveSessionServiceConfigs()
		: resolvedDependencies.resolveTelegramSessions(phiConfig);
	const feishuSessions =
		resolvedDependencies.resolveFeishuSessions(phiConfig);
	const telegramWildcardRoutes = telegramRouteRegistry
		? telegramRouteRegistry.resolveWildcardRouteConfigs()
		: resolvedDependencies.resolveTelegramWildcardRoutes(phiConfig);
	const cronSessions = resolvedDependencies.resolveCronSessions(phiConfig);
	const sessionExecutor = resolvedDependencies.createSessionExecutor();
	const reloadRegistry = resolvedDependencies.createReloadRegistry();
	const routes = resolvedDependencies.createRoutes();
	const serviceSessions = collectServiceSessions(
		cronSessions,
		telegramSessions,
		feishuSessions
	);
	log.info("service.command.starting", {
		telegramSessionCount: telegramSessions.length,
		feishuSessionCount: feishuSessions.length,
		cronSessionCount: cronSessions.length,
		serviceSessionCount: serviceSessions.length,
	});
	const telegramEndpointConfigs = buildTelegramEndpointConfigs({
		sessionConfigs: telegramSessions,
		wildcardConfigs: telegramWildcardRoutes,
	});
	const feishuEndpointConfigs = buildFeishuEndpointConfigs(feishuSessions);

	const runningServices: RunningServicePart[] = [];
	const sessions: Session[] = [];
	const unregisterHandlers: Array<() => void> = [];
	const sessionRuntimes = new Map<string, Session>();
	const ensureServiceSession = (serviceSession: {
		sessionId: string;
		configSessionId?: string;
		chatId: string;
	}): Session => {
		const existingSession = sessionRuntimes.get(serviceSession.sessionId);
		if (existingSession) {
			return existingSession;
		}
		const session = resolvedDependencies.createSession({
			sessionId: serviceSession.sessionId,
			configSessionId: serviceSession.configSessionId,
			chatId: serviceSession.chatId,
			phiConfig,
			runtime,
			sessionExecutor,
			routes,
			reloadRegistry,
		});
		sessionRuntimes.set(serviceSession.sessionId, session);
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
		return session;
	};
	try {
		for (const serviceSession of serviceSessions) {
			ensureServiceSession(serviceSession);
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
				wildcardEnabled: endpointConfig.wildcardRoute !== undefined,
			});
			const runningEndpoint =
				await resolvedDependencies.startTelegramEndpoint(
					routes,
					endpointConfig,
					{
						resolveRouteTarget: async (routeId) => {
							const sessionConfig = bindTelegramChatRoute({
								phiConfig,
								token: endpointConfig.token,
								chatId: routeId,
								registry: telegramRouteRegistry,
							});
							if (!sessionConfig) {
								return undefined;
							}
							ensureServiceSession({
								sessionId: sessionConfig.sessionId,
								configSessionId: sessionConfig.configSessionId,
								chatId: sessionConfig.chatId,
							});
							return {
								sessionId: sessionConfig.sessionId,
								chatId: sessionConfig.chatId,
								workspace: sessionConfig.workspace,
							};
						},
					}
				);
			runningServices.push(runningEndpoint);
			log.info("service.telegram.started", {
				routeCount: Object.keys(endpointConfig.chatRoutes).length,
				wildcardEnabled: endpointConfig.wildcardRoute !== undefined,
			});
		}

		for (const endpointConfig of feishuEndpointConfigs) {
			log.info("service.feishu.starting", {
				routeCount: Object.keys(endpointConfig.chatRoutes).length,
			});
			const runningEndpoint =
				await resolvedDependencies.startFeishuEndpoint(
					routes,
					endpointConfig
				);
			runningServices.push(runningEndpoint);
			log.info("service.feishu.started", {
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
