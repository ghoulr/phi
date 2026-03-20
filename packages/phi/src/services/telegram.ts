import { randomUUID } from "node:crypto";

import { appendChatLogEntry } from "@phi/core/chat-log";
import {
	ensureChatWorkspaceLayout,
	resolveChatWorkspaceDirectory,
} from "@phi/core/chat-workspace";
import { getPhiLogger } from "@phi/core/logger";
import {
	formatUserFacingErrorMessage,
	normalizeUnknownError,
} from "@phi/core/user-error";
import type { PhiMessage } from "@phi/messaging/types";
import type { ServiceRoutes } from "@phi/services/routes";

import {
	TelegramProvider,
	type TelegramBotFactory,
	type TelegramRouteTarget,
} from "./endpoints/telegram-provider.js";
import {
	createIdempotencyKey,
	resolveOutboundAuditText,
} from "./endpoints/shared.js";
import type {
	EndpointAttachment,
	EndpointInboundContext,
} from "./endpoints/types.js";

export type {
	TelegramRouteTarget,
	TelegramBotFactory,
} from "./endpoints/telegram-provider.js";

const log = getPhiLogger("telegram");

export interface RunningTelegramEndpoint {
	done: Promise<void>;
	stop(): Promise<void>;
}

export interface TelegramWildcardRouteTarget {
	configSessionId: string;
	chatId: string;
	workspace: string;
}

export interface ResolvedTelegramEndpointConfig {
	token: string;
	chatRoutes: Record<string, TelegramRouteTarget>;
	wildcardRoute?: TelegramWildcardRouteTarget;
}

export interface TelegramEndpointDependencies {
	botFactory?: TelegramBotFactory;
	resolveRouteTarget?(
		routeId: string
	): Promise<TelegramRouteTarget | undefined>;
}

function createOutboundAuditKey(routeId: string): string {
	return createIdempotencyKey("telegram", routeId, "outbound", randomUUID());
}

function appendTelegramOutboundAssistantLog(params: {
	idempotencyKey: string;
	routeId: string;
	target: TelegramRouteTarget;
	message: PhiMessage;
}): void {
	appendChatLogEntry({
		idempotencyKey: params.idempotencyKey,
		endpoint: "telegram",
		chatId: params.target.chatId,
		telegramChatId: params.routeId,
		direction: "outbound",
		source: "assistant",
		text: resolveOutboundAuditText(params.message),
	});
}

function appendTelegramOutboundErrorLog(params: {
	idempotencyKey: string;
	routeId: string;
	target: TelegramRouteTarget;
	errorText: string;
}): void {
	appendChatLogEntry({
		idempotencyKey: params.idempotencyKey,
		endpoint: "telegram",
		chatId: params.target.chatId,
		telegramChatId: params.routeId,
		direction: "outbound",
		source: "error",
		text: params.errorText,
	});
}

export async function startTelegramEndpoint(
	routes: ServiceRoutes,
	config: ResolvedTelegramEndpointConfig,
	dependencies: TelegramBotFactory | TelegramEndpointDependencies = {}
): Promise<RunningTelegramEndpoint> {
	const resolvedDependencies: TelegramEndpointDependencies =
		typeof dependencies === "function"
			? { botFactory: dependencies }
			: dependencies;

	log.info("telegram.bot.starting", {
		routeCount: Object.keys(config.chatRoutes).length,
		sessionIds: Object.values(config.chatRoutes).map(
			(target) => target.sessionId
		),
	});

	for (const target of Object.values(config.chatRoutes)) {
		const workspaceDir = resolveChatWorkspaceDirectory(target.workspace);
		ensureChatWorkspaceLayout(workspaceDir);
	}

	const callbacks = {
		shouldProcess(routeId: string): boolean {
			return (
				routeId in config.chatRoutes ||
				config.wildcardRoute !== undefined
			);
		},

		resolveWorkspace(routeId: string): string {
			const target = config.chatRoutes[routeId] ?? config.wildcardRoute;
			if (!target) {
				throw new Error(`No route for chat id: ${routeId}`);
			}
			return resolveChatWorkspaceDirectory(target.workspace);
		},

		onSuccess(
			routeId: string,
			updateId: number,
			messageId: string,
			text?: string,
			attachments?: EndpointAttachment[]
		): void {
			const target = config.chatRoutes[routeId];
			if (!target) return;

			appendChatLogEntry({
				idempotencyKey: createIdempotencyKey(
					"telegram",
					routeId,
					updateId
				),
				endpoint: "telegram",
				chatId: target.chatId,
				telegramChatId: routeId,
				telegramUpdateId: String(updateId),
				telegramMessageId: messageId,
				direction: "inbound",
				source: "user",
				text: text ?? `[${attachments?.length ?? 0} attachment(s)]`,
			});

			log.info("telegram.message.completed", {
				routeId,
				chatId: target.chatId,
				sessionId: target.sessionId,
				messageId,
			});
		},

		onError(
			routeId: string,
			updateId: number,
			messageId: string,
			error: unknown
		): void {
			const target = config.chatRoutes[routeId];
			if (!target) return;

			const errorText = formatUserFacingErrorMessage(error);
			log.error("telegram.message.failed", {
				routeId,
				chatId: target.chatId,
				sessionId: target.sessionId,
				messageId,
				err: normalizeUnknownError(error),
			});

			appendChatLogEntry({
				idempotencyKey: createIdempotencyKey(
					"telegram",
					routeId,
					updateId
				),
				endpoint: "telegram",
				chatId: target.chatId,
				telegramChatId: routeId,
				direction: "outbound",
				source: "error",
				text: errorText,
			});
		},
	};

	const provider = TelegramProvider.create({
		token: config.token,
		botFactory: resolvedDependencies.botFactory,
		callbacks,
		onMessage: async (ctx: EndpointInboundContext) => {
			let target = config.chatRoutes[ctx.routeId];
			if (!target && resolvedDependencies.resolveRouteTarget) {
				target = await resolvedDependencies.resolveRouteTarget(
					ctx.routeId
				);
				if (target) {
					registerRoute(ctx.routeId, target);
				}
			}
			if (!target) {
				throw new Error(
					`No session configured for telegram chat id: ${ctx.routeId}`
				);
			}
			await routes.dispatchInteractive(ctx.instanceId, ctx.routeId, {
				text: ctx.text,
				attachments: ctx.attachments,
				metadata: ctx.metadata,
				sendTyping: ctx.sendTyping,
			});
		},
	});

	const unregisterRoutes: Array<() => void> = [];
	const registeredInteractiveRoutes = new Set<string>();
	const registeredOutboundSessions = new Set<string>();
	const registerRoute = (
		routeId: string,
		target: TelegramRouteTarget
	): void => {
		config.chatRoutes[routeId] = target;
		const interactiveKey = `${provider.instanceId}\u0000${routeId}`;
		if (!registeredInteractiveRoutes.has(interactiveKey)) {
			registeredInteractiveRoutes.add(interactiveKey);
			unregisterRoutes.push(
				routes.registerInteractiveRoute(
					provider.instanceId,
					routeId,
					target.sessionId
				)
			);
		}
		if (registeredOutboundSessions.has(target.sessionId)) {
			return;
		}
		registeredOutboundSessions.add(target.sessionId);
		unregisterRoutes.push(
			routes.registerOutboundRoute(
				provider.instanceId,
				target.sessionId,
				{
					deliver: async (activeRouteId, message) => {
						const activeTarget = config.chatRoutes[activeRouteId];
						if (!activeTarget) {
							throw new Error(
								`No telegram target configured for route ${activeRouteId}`
							);
						}
						const idempotencyKey =
							createOutboundAuditKey(activeRouteId);
						const fields = {
							routeId: activeRouteId,
							chatId: activeTarget.chatId,
							sessionId: activeTarget.sessionId,
							textLength: message.text?.length,
							attachmentCount: message.attachments.length,
						};
						log.info("telegram.outbound.sending", fields);
						try {
							await provider.send(activeRouteId, {
								text: message.text,
								attachments: message.attachments,
							});
							appendTelegramOutboundAssistantLog({
								idempotencyKey,
								routeId: activeRouteId,
								target: activeTarget,
								message,
							});
							log.info("telegram.outbound.sent", fields);
						} catch (error: unknown) {
							const errorText =
								formatUserFacingErrorMessage(error);
							appendTelegramOutboundErrorLog({
								idempotencyKey,
								routeId: activeRouteId,
								target: activeTarget,
								errorText,
							});
							log.error("telegram.outbound.failed", {
								...fields,
								err: normalizeUnknownError(error),
							});
							throw error;
						}
					},
				}
			)
		);
	};

	for (const [routeId, target] of Object.entries(config.chatRoutes)) {
		registerRoute(routeId, target);
	}

	let routesUnregistered = false;
	function unregisterAllRoutes(): void {
		if (routesUnregistered) {
			return;
		}
		routesUnregistered = true;
		for (const unregister of unregisterRoutes) {
			unregister();
		}
	}

	const runningDone = provider
		.startWithFatalHandler()
		.then(
			() => {
				log.info("telegram.bot.started", {
					routeCount: Object.keys(config.chatRoutes).length,
				});
			},
			(error: unknown) => {
				log.error("telegram.bot.stopped_with_error", {
					err: normalizeUnknownError(error),
				});
				throw error;
			}
		)
		.finally(() => {
			unregisterAllRoutes();
		});

	return {
		done: runningDone,
		async stop(): Promise<void> {
			unregisterAllRoutes();
			await provider.stop();
			log.info("telegram.bot.stopped", {
				routeCount: Object.keys(config.chatRoutes).length,
			});
		},
	};
}
