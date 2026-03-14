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
	outboundDestination: string;
	metadata?: Record<string, unknown>;
	sendTyping(): Promise<unknown>;
}

export interface ChatHandlerCronInput {
	text: string;
	outboundDestination: string;
}

export interface ChatDeliveryRoute {
	deliver(message: PhiMessage): Promise<void>;
}

function createInteractiveRouteKey(
	endpointId: string,
	routeId: string
): string {
	return `${endpointId}\u0000${routeId}`;
}

export class ServiceRoutes {
	private readonly chatHandlers = new Map<string, ChatHandler>();
	private readonly interactiveRoutes = new Map<string, string>();
	private readonly outboundRoutes = new Map<
		string,
		Map<string, ChatDeliveryRoute>
	>();

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
		outboundDestination: string,
		delivery: ChatDeliveryRoute
	): () => void {
		const destinations =
			this.outboundRoutes.get(chatId) ??
			new Map<string, ChatDeliveryRoute>();
		const existingDelivery = destinations.get(outboundDestination);
		if (existingDelivery) {
			throw new Error(
				`Duplicate outbound route for chat ${chatId} and destination ${outboundDestination}`
			);
		}
		destinations.set(outboundDestination, delivery);
		this.outboundRoutes.set(chatId, destinations);
		return () => {
			const currentDestinations = this.outboundRoutes.get(chatId);
			if (!currentDestinations) {
				return;
			}
			if (currentDestinations.get(outboundDestination) === delivery) {
				currentDestinations.delete(outboundDestination);
			}
			if (currentDestinations.size === 0) {
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
		message: PhiMessage,
		outboundDestination: string
	): Promise<void> {
		const delivery = this.outboundRoutes
			.get(chatId)
			?.get(outboundDestination);
		if (!delivery) {
			throw new Error(
				`No outbound route configured for chat ${chatId} and destination ${outboundDestination}`
			);
		}
		await delivery.deliver(message);
	}

	private requireChatHandler(chatId: string): ChatHandler {
		const handler = this.chatHandlers.get(chatId);
		if (!handler) {
			throw new Error(`No chat handler registered for chat ${chatId}`);
		}
		return handler;
	}
}
