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
		endpointChatId: string
	): Promise<TelegramRouteTarget | undefined>;
}

function createOutboundAuditKey(endpointChatId: string): string {
	return createIdempotencyKey(
		"telegram",
		endpointChatId,
		"outbound",
		randomUUID()
	);
}

function appendTelegramOutboundAssistantLog(params: {
	idempotencyKey: string;
	endpointChatId: string;
	target: TelegramRouteTarget;
	message: PhiMessage;
}): void {
	appendChatLogEntry({
		idempotencyKey: params.idempotencyKey,
		endpoint: "telegram",
		chatId: params.target.chatId,
		telegramChatId: params.endpointChatId,
		direction: "outbound",
		source: "assistant",
		text: resolveOutboundAuditText(params.message),
	});
}

function appendTelegramOutboundErrorLog(params: {
	idempotencyKey: string;
	endpointChatId: string;
	target: TelegramRouteTarget;
	errorText: string;
}): void {
	appendChatLogEntry({
		idempotencyKey: params.idempotencyKey,
		endpoint: "telegram",
		chatId: params.target.chatId,
		telegramChatId: params.endpointChatId,
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
		shouldProcess(endpointChatId: string): boolean {
			return (
				endpointChatId in config.chatRoutes ||
				config.wildcardRoute !== undefined
			);
		},

		resolveWorkspace(endpointChatId: string): string {
			const target =
				config.chatRoutes[endpointChatId] ?? config.wildcardRoute;
			if (!target) {
				throw new Error(`No route for chat id: ${endpointChatId}`);
			}
			return resolveChatWorkspaceDirectory(target.workspace);
		},

		onSuccess(
			endpointChatId: string,
			updateId: number,
			messageId: string,
			text?: string,
			attachments?: EndpointAttachment[]
		): void {
			const target = config.chatRoutes[endpointChatId];
			if (!target) return;

			appendChatLogEntry({
				idempotencyKey: createIdempotencyKey(
					"telegram",
					endpointChatId,
					updateId
				),
				endpoint: "telegram",
				chatId: target.chatId,
				telegramChatId: endpointChatId,
				telegramUpdateId: String(updateId),
				telegramMessageId: messageId,
				direction: "inbound",
				source: "user",
				text: text ?? `[${attachments?.length ?? 0} attachment(s)]`,
			});

			log.info("telegram.message.completed", {
				endpointChatId,
				chatId: target.chatId,
				sessionId: target.sessionId,
				messageId,
			});
		},

		onError(
			endpointChatId: string,
			updateId: number,
			messageId: string,
			error: unknown
		): void {
			const target = config.chatRoutes[endpointChatId];
			if (!target) return;

			const errorText = formatUserFacingErrorMessage(error);
			log.error("telegram.message.failed", {
				endpointChatId,
				chatId: target.chatId,
				sessionId: target.sessionId,
				messageId,
				err: normalizeUnknownError(error),
			});

			appendChatLogEntry({
				idempotencyKey: createIdempotencyKey(
					"telegram",
					endpointChatId,
					updateId
				),
				endpoint: "telegram",
				chatId: target.chatId,
				telegramChatId: endpointChatId,
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
			let target = config.chatRoutes[ctx.endpointChatId];
			if (!target && resolvedDependencies.resolveRouteTarget) {
				target = await resolvedDependencies.resolveRouteTarget(
					ctx.endpointChatId
				);
				if (target) {
					registerRoute(ctx.endpointChatId, target);
				}
			}
			if (!target) {
				throw new Error(
					`No session configured for telegram chat id: ${ctx.endpointChatId}`
				);
			}
			await routes.dispatchInteractive(
				ctx.instanceId,
				ctx.endpointChatId,
				{
					text: ctx.text,
					attachments: ctx.attachments,
					metadata: ctx.metadata,
					sendTyping: ctx.sendTyping,
				}
			);
		},
	});

	const unregisterRoutes: Array<() => void> = [];
	const registeredInteractiveRoutes = new Set<string>();
	const registeredOutboundRoutes = new Set<string>();
	const registerRoute = (
		endpointChatId: string,
		target: TelegramRouteTarget
	): void => {
		config.chatRoutes[endpointChatId] = target;
		const interactiveKey = `${provider.instanceId}\u0000${endpointChatId}`;
		if (!registeredInteractiveRoutes.has(interactiveKey)) {
			registeredInteractiveRoutes.add(interactiveKey);
			unregisterRoutes.push(
				routes.registerInteractiveRoute(
					provider.instanceId,
					endpointChatId,
					target.sessionId
				)
			);
		}
		const outboundKey = `${target.sessionId}\u0000${endpointChatId}`;
		if (registeredOutboundRoutes.has(outboundKey)) {
			return;
		}
		registeredOutboundRoutes.add(outboundKey);
		unregisterRoutes.push(
			routes.registerOutboundRoute(target.sessionId, endpointChatId, {
				deliver: async (message) => {
					const idempotencyKey =
						createOutboundAuditKey(endpointChatId);
					const fields = {
						endpointChatId,
						chatId: target.chatId,
						sessionId: target.sessionId,
						textLength: message.text?.length,
						attachmentCount: message.attachments.length,
					};
					log.info("telegram.outbound.sending", fields);
					try {
						await provider.send(endpointChatId, {
							text: message.text,
							attachments: message.attachments,
						});
						appendTelegramOutboundAssistantLog({
							idempotencyKey,
							endpointChatId: endpointChatId,
							target,
							message,
						});
						log.info("telegram.outbound.sent", fields);
					} catch (error: unknown) {
						const errorText = formatUserFacingErrorMessage(error);
						appendTelegramOutboundErrorLog({
							idempotencyKey,
							endpointChatId: endpointChatId,
							target,
							errorText,
						});
						log.error("telegram.outbound.failed", {
							...fields,
							err: normalizeUnknownError(error),
						});
						throw error;
					}
				},
			})
		);
	};

	for (const [endpointChatId, target] of Object.entries(config.chatRoutes)) {
		registerRoute(endpointChatId, target);
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
