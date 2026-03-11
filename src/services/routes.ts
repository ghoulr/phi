import { getPhiLogger } from "@phi/core/logger";
import type { PhiMessage } from "@phi/messaging/types";
import type { ChatHandler } from "@phi/services/chat-handler";

export interface ChatHandlerInteractiveAttachment {
	path: string;
	name: string;
	mimeType?: string;
}

export interface ChatHandlerInteractiveInput {
	text?: string;
	attachments: ChatHandlerInteractiveAttachment[];
	metadata?: Record<string, unknown>;
	sendTyping(): Promise<unknown>;
}

export interface ChatHandlerCronInput {
	text: string;
}

export interface ChatDeliveryRoute {
	deliver(message: PhiMessage): Promise<void>;
}

const log = getPhiLogger("routes");

function createInteractiveRouteKey(
	endpointId: string,
	routeId: string
): string {
	return `${endpointId}\u0000${routeId}`;
}

export class ServiceRoutes {
	private readonly chatHandlers = new Map<string, ChatHandler>();
	private readonly interactiveRoutes = new Map<string, string>();
	private readonly outboundRoutes = new Map<string, Set<ChatDeliveryRoute>>();

	public registerChatHandler(
		chatId: string,
		handler: ChatHandler
	): () => void {
		const existingHandler = this.chatHandlers.get(chatId);
		if (existingHandler && existingHandler !== handler) {
			throw new Error(`Duplicate chat handler for chat ${chatId}`);
		}
		this.chatHandlers.set(chatId, handler);
		return () => {
			if (this.chatHandlers.get(chatId) === handler) {
				this.chatHandlers.delete(chatId);
			}
		};
	}

	public registerInteractiveRoute(
		endpointId: string,
		routeId: string,
		chatId: string
	): () => void {
		const routeKey = createInteractiveRouteKey(endpointId, routeId);
		const existingChatId = this.interactiveRoutes.get(routeKey);
		if (existingChatId && existingChatId !== chatId) {
			throw new Error(
				`Duplicate interactive route for endpoint ${endpointId} and route ${routeId}`
			);
		}
		this.interactiveRoutes.set(routeKey, chatId);
		return () => {
			if (this.interactiveRoutes.get(routeKey) === chatId) {
				this.interactiveRoutes.delete(routeKey);
			}
		};
	}

	public registerOutboundRoute(
		chatId: string,
		delivery: ChatDeliveryRoute
	): () => void {
		const deliveries =
			this.outboundRoutes.get(chatId) ?? new Set<ChatDeliveryRoute>();
		deliveries.add(delivery);
		this.outboundRoutes.set(chatId, deliveries);
		return () => {
			const currentDeliveries = this.outboundRoutes.get(chatId);
			if (!currentDeliveries) {
				return;
			}
			currentDeliveries.delete(delivery);
			if (currentDeliveries.size === 0) {
				this.outboundRoutes.delete(chatId);
			}
		};
	}

	public async dispatchInteractive(
		endpointId: string,
		routeId: string,
		input: ChatHandlerInteractiveInput
	): Promise<void> {
		const chatId = this.interactiveRoutes.get(
			createInteractiveRouteKey(endpointId, routeId)
		);
		if (!chatId) {
			throw new Error(
				`No chat configured for route ${routeId} on endpoint ${endpointId}`
			);
		}
		await this.requireChatHandler(chatId).submitInteractive(input);
	}

	public async dispatchCron(
		chatId: string,
		input: ChatHandlerCronInput
	): Promise<PhiMessage[]> {
		return await this.requireChatHandler(chatId).submitCron(input);
	}

	public async deliverOutbound(
		chatId: string,
		message: PhiMessage
	): Promise<void> {
		const deliveries = Array.from(this.outboundRoutes.get(chatId) ?? []);
		const results = await Promise.all(
			deliveries.map(async (delivery, index) => {
				try {
					await delivery.deliver(message);
					return { ok: true, index } as const;
				} catch (error: unknown) {
					return { ok: false, error, index } as const;
				}
			})
		);
		const failedResults = results.filter(
			(result): result is { ok: false; error: unknown; index: number } =>
				result.ok === false
		);
		if (failedResults.length === 0) {
			return;
		}
		if (failedResults.length === deliveries.length) {
			throw new AggregateError(
				failedResults.map((result) => result.error),
				`All outbound routes failed for chat ${chatId}`
			);
		}
		log.warn("routes.delivery.partial_failed", {
			chatId,
			deliveryCount: deliveries.length,
			failedDeliveryCount: failedResults.length,
			failedDeliveryIndexes: failedResults.map((result) => result.index),
			textLength: message.text?.length,
			attachmentCount: message.attachments.length,
		});
	}

	private requireChatHandler(chatId: string): ChatHandler {
		const handler = this.chatHandlers.get(chatId);
		if (!handler) {
			throw new Error(`No chat handler registered for chat ${chatId}`);
		}
		return handler;
	}
}
