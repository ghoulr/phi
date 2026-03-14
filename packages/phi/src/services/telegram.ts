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
import { createIdempotencyKey } from "./endpoints/shared.js";
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

export interface ResolvedTelegramEndpointConfig {
	token: string;
	chatRoutes: Record<string, TelegramRouteTarget>;
}

function resolveOutboundAuditText(message: PhiMessage): string {
	return message.text ?? `[${message.attachments.length} attachment(s)]`;
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
	botFactory?: TelegramBotFactory
): Promise<RunningTelegramEndpoint> {
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
			return routeId in config.chatRoutes;
		},

		resolveWorkspace(routeId: string): string {
			const target = config.chatRoutes[routeId];
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

	const onMessage = async (ctx: EndpointInboundContext) => {
		const target = config.chatRoutes[ctx.routeId];
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
	};

	const provider = TelegramProvider.create({
		token: config.token,
		botFactory,
		callbacks,
		onMessage,
	});

	const unregisterRoutes: Array<() => void> = [];
	for (const [routeId, target] of Object.entries(config.chatRoutes)) {
		unregisterRoutes.push(
			routes.registerInteractiveRoute(
				provider.instanceId,
				routeId,
				target.sessionId
			)
		);
		unregisterRoutes.push(
			routes.registerOutboundRoute(target.sessionId, {
				deliver: async (message) => {
					const idempotencyKey = createOutboundAuditKey(routeId);
					const fields = {
						routeId,
						chatId: target.chatId,
						sessionId: target.sessionId,
						textLength: message.text?.length,
						attachmentCount: message.attachments.length,
					};
					log.info("telegram.outbound.sending", fields);
					try {
						await provider.send(routeId, {
							text: message.text,
							attachments: message.attachments,
						});
						appendTelegramOutboundAssistantLog({
							idempotencyKey,
							routeId,
							target,
							message,
						});
						log.info("telegram.outbound.sent", fields);
					} catch (error: unknown) {
						const errorText = formatUserFacingErrorMessage(error);
						appendTelegramOutboundErrorLog({
							idempotencyKey,
							routeId,
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
