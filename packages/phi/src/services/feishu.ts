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
	FeishuProvider,
	type FeishuClientFactory,
	type FeishuEventDispatcherFactory,
	type FeishuRouteTarget,
	type FeishuWsClientFactory,
} from "./endpoints/feishu-provider.js";
import {
	createIdempotencyKey,
	resolveOutboundAuditText,
} from "./endpoints/shared.js";
import type {
	EndpointAttachment,
	EndpointInboundContext,
} from "./endpoints/types.js";

export type {
	FeishuClientFactory,
	FeishuEventDispatcherFactory,
	FeishuRouteTarget,
	FeishuWsClientFactory,
} from "./endpoints/feishu-provider.js";

const log = getPhiLogger("feishu");

export interface RunningFeishuEndpoint {
	done: Promise<void>;
	stop(): Promise<void>;
}

export interface ResolvedFeishuEndpointConfig {
	appId: string;
	appSecret: string;
	chatRoutes: Record<string, FeishuRouteTarget>;
}

export interface FeishuEndpointDependencies {
	clientFactory?: FeishuClientFactory;
	eventDispatcherFactory?: FeishuEventDispatcherFactory;
	wsClientFactory?: FeishuWsClientFactory;
}

function createOutboundAuditKey(routeId: string): string {
	return createIdempotencyKey("feishu", routeId, "outbound", randomUUID());
}

function appendFeishuOutboundAssistantLog(params: {
	idempotencyKey: string;
	routeId: string;
	target: FeishuRouteTarget;
	message: PhiMessage;
}): void {
	appendChatLogEntry({
		idempotencyKey: params.idempotencyKey,
		endpoint: "feishu",
		chatId: params.target.chatId,
		feishuChatId: params.routeId,
		direction: "outbound",
		source: "assistant",
		text: resolveOutboundAuditText(params.message),
	});
}

function appendFeishuOutboundErrorLog(params: {
	idempotencyKey: string;
	routeId: string;
	target: FeishuRouteTarget;
	errorText: string;
}): void {
	appendChatLogEntry({
		idempotencyKey: params.idempotencyKey,
		endpoint: "feishu",
		chatId: params.target.chatId,
		feishuChatId: params.routeId,
		direction: "outbound",
		source: "error",
		text: params.errorText,
	});
}

export async function startFeishuEndpoint(
	routes: ServiceRoutes,
	config: ResolvedFeishuEndpointConfig,
	dependencies: FeishuEndpointDependencies = {}
): Promise<RunningFeishuEndpoint> {
	log.info("feishu.ws.starting", {
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
			eventId: string,
			messageId: string,
			text?: string,
			attachments?: EndpointAttachment[]
		): void {
			const target = config.chatRoutes[routeId];
			if (!target) {
				return;
			}
			appendChatLogEntry({
				idempotencyKey: createIdempotencyKey(
					"feishu",
					routeId,
					eventId
				),
				endpoint: "feishu",
				chatId: target.chatId,
				feishuChatId: routeId,
				feishuEventId: eventId,
				feishuMessageId: messageId,
				direction: "inbound",
				source: "user",
				text: text ?? `[${attachments?.length ?? 0} attachment(s)]`,
			});
			log.info("feishu.message.completed", {
				routeId,
				chatId: target.chatId,
				sessionId: target.sessionId,
				messageId,
			});
		},

		onError(
			routeId: string,
			eventId: string,
			messageId: string,
			error: unknown
		): void {
			const target = config.chatRoutes[routeId];
			if (!target) {
				return;
			}
			const errorText = formatUserFacingErrorMessage(error);
			log.error("feishu.message.failed", {
				routeId,
				chatId: target.chatId,
				sessionId: target.sessionId,
				messageId,
				err: normalizeUnknownError(error),
			});
			appendChatLogEntry({
				idempotencyKey: createIdempotencyKey(
					"feishu",
					routeId,
					eventId
				),
				endpoint: "feishu",
				chatId: target.chatId,
				feishuChatId: routeId,
				feishuEventId: eventId,
				feishuMessageId: messageId,
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
				`No session configured for feishu chat id: ${ctx.routeId}`
			);
		}
		await routes.dispatchInteractive(ctx.instanceId, ctx.routeId, {
			text: ctx.text,
			attachments: ctx.attachments,
			metadata: ctx.metadata,
			sendTyping: ctx.sendTyping,
		});
	};

	const provider = FeishuProvider.create({
		appId: config.appId,
		appSecret: config.appSecret,
		clientFactory: dependencies.clientFactory,
		eventDispatcherFactory: dependencies.eventDispatcherFactory,
		wsClientFactory: dependencies.wsClientFactory,
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
					log.info("feishu.outbound.sending", fields);
					try {
						await provider.send(routeId, {
							text: message.text,
							attachments: message.attachments,
						});
						appendFeishuOutboundAssistantLog({
							idempotencyKey,
							routeId,
							target,
							message,
						});
						log.info("feishu.outbound.sent", fields);
					} catch (error: unknown) {
						const errorText = formatUserFacingErrorMessage(error);
						appendFeishuOutboundErrorLog({
							idempotencyKey,
							routeId,
							target,
							errorText,
						});
						log.error("feishu.outbound.failed", {
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

	try {
		await provider.startWithFatalHandler();
	} catch (error: unknown) {
		unregisterAllRoutes();
		await provider.stop();
		throw error;
	}

	log.info("feishu.ws.started", {
		routeCount: Object.keys(config.chatRoutes).length,
	});

	const runningDone = provider.done
		.catch((error: unknown) => {
			log.error("feishu.ws.stopped_with_error", {
				err: normalizeUnknownError(error),
			});
			throw error;
		})
		.finally(() => {
			unregisterAllRoutes();
		});

	let stopping = false;
	return {
		done: runningDone,
		async stop(): Promise<void> {
			if (stopping) {
				return;
			}
			stopping = true;
			unregisterAllRoutes();
			await provider.stop();
			log.info("feishu.ws.stopped", {
				routeCount: Object.keys(config.chatRoutes).length,
			});
		},
	};
}
