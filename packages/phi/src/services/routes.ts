import type { PhiMessage } from "@phi/messaging/types";
import type { Session } from "@phi/services/session";

export interface InteractiveAttachment {
	path: string;
	name: string;
	mimeType?: string;
}

export interface InteractiveInput {
	text?: string;
	attachments: InteractiveAttachment[];
	metadata?: Record<string, unknown>;
	sendTyping(): Promise<unknown>;
}

export interface CronInput {
	text: string;
	endpointChatId: string;
}

export interface SessionDelivery {
	deliver(message: PhiMessage): Promise<void>;
}

function createInteractiveRouteKey(
	endpointId: string,
	endpointChatId: string
): string {
	return `${endpointId}\u0000${endpointChatId}`;
}

function createOutboundRouteKey(
	sessionId: string,
	endpointChatId: string
): string {
	return `${sessionId}\u0000${endpointChatId}`;
}

export class ServiceRoutes {
	private readonly sessions = new Map<string, Session>();
	private readonly interactiveRoutes = new Map<string, string>();
	private readonly outboundRoutes = new Map<string, SessionDelivery>();
	private readonly sessionEndpointChatIds = new Map<string, Set<string>>();
	private readonly activeInteractiveContexts = new Map<string, string>();

	public registerSession(sessionId: string, session: Session): () => void {
		const existingSession = this.sessions.get(sessionId);
		if (existingSession && existingSession !== session) {
			throw new Error(
				`Duplicate session runtime for session ${sessionId}`
			);
		}
		this.sessions.set(sessionId, session);
		return () => {
			if (this.sessions.get(sessionId) === session) {
				this.sessions.delete(sessionId);
			}
		};
	}

	public registerInteractiveRoute(
		endpointId: string,
		endpointChatId: string,
		sessionId: string
	): () => void {
		const routeKey = createInteractiveRouteKey(endpointId, endpointChatId);
		const existingSessionId = this.interactiveRoutes.get(routeKey);
		if (existingSessionId && existingSessionId !== sessionId) {
			throw new Error(
				`Duplicate interactive route for endpoint ${endpointId} and chat ${endpointChatId}`
			);
		}
		this.interactiveRoutes.set(routeKey, sessionId);
		return () => {
			if (this.interactiveRoutes.get(routeKey) === sessionId) {
				this.interactiveRoutes.delete(routeKey);
			}
		};
	}

	public registerOutboundRoute(
		sessionId: string,
		endpointChatId: string,
		delivery: SessionDelivery
	): () => void {
		const routeKey = createOutboundRouteKey(sessionId, endpointChatId);
		const existingDelivery = this.outboundRoutes.get(routeKey);
		if (existingDelivery) {
			throw new Error(
				`Duplicate outbound route for session ${sessionId} and chat ${endpointChatId}`
			);
		}
		this.outboundRoutes.set(routeKey, delivery);
		let endpointChatIds = this.sessionEndpointChatIds.get(sessionId);
		if (!endpointChatIds) {
			endpointChatIds = new Set<string>();
			this.sessionEndpointChatIds.set(sessionId, endpointChatIds);
		}
		endpointChatIds.add(endpointChatId);
		return () => {
			if (this.outboundRoutes.get(routeKey) === delivery) {
				this.outboundRoutes.delete(routeKey);
			}
			const currentEndpointChatIds =
				this.sessionEndpointChatIds.get(sessionId);
			currentEndpointChatIds?.delete(endpointChatId);
			if (currentEndpointChatIds?.size === 0) {
				this.sessionEndpointChatIds.delete(sessionId);
			}
		};
	}

	public async dispatchInteractive(
		endpointId: string,
		endpointChatId: string,
		input: InteractiveInput
	): Promise<void> {
		const sessionId = this.interactiveRoutes.get(
			createInteractiveRouteKey(endpointId, endpointChatId)
		);
		if (!sessionId) {
			throw new Error(
				`No session configured for chat ${endpointChatId} on endpoint ${endpointId}`
			);
		}
		const previousContext = this.activeInteractiveContexts.get(sessionId);
		this.activeInteractiveContexts.set(sessionId, endpointChatId);
		try {
			await this.requireSession(sessionId).submitInteractive(input);
		} finally {
			if (previousContext) {
				this.activeInteractiveContexts.set(sessionId, previousContext);
			} else {
				this.activeInteractiveContexts.delete(sessionId);
			}
		}
	}

	public async dispatchCron(
		sessionId: string,
		input: CronInput
	): Promise<PhiMessage[]> {
		return await this.requireSession(sessionId).submitCron(input);
	}

	public resolveEndpointChatId(sessionId: string): string {
		return (
			this.activeInteractiveContexts.get(sessionId) ??
			this.resolveDefaultEndpointChatId(sessionId)
		);
	}

	public async deliverOutboundToEndpointChat(
		sessionId: string,
		endpointChatId: string,
		message: PhiMessage
	): Promise<void> {
		const delivery = this.outboundRoutes.get(
			createOutboundRouteKey(sessionId, endpointChatId)
		);
		if (!delivery) {
			throw new Error(
				`No outbound route configured for session ${sessionId} and chat ${endpointChatId}`
			);
		}
		await delivery.deliver(message);
	}

	public async deliverOutbound(
		sessionId: string,
		message: PhiMessage
	): Promise<void> {
		await this.deliverOutboundToEndpointChat(
			sessionId,
			this.resolveEndpointChatId(sessionId),
			message
		);
	}

	private resolveDefaultEndpointChatId(sessionId: string): string {
		const endpointChatIds = this.sessionEndpointChatIds.get(sessionId);
		if (!endpointChatIds || endpointChatIds.size === 0) {
			throw new Error(
				`No outbound route configured for session ${sessionId}`
			);
		}
		if (endpointChatIds.size !== 1) {
			throw new Error(
				`No active outbound route for session ${sessionId}`
			);
		}
		const endpointChatId = endpointChatIds.values().next().value;
		if (!endpointChatId) {
			throw new Error(
				`No active outbound route for session ${sessionId}`
			);
		}
		return endpointChatId;
	}

	private requireSession(sessionId: string): Session {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(
				`No session runtime registered for session ${sessionId}`
			);
		}
		return session;
	}
}
