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
}

export interface SessionDelivery {
	deliver(routeId: string, message: PhiMessage): Promise<void>;
}

function createInteractiveRouteKey(
	endpointId: string,
	routeId: string
): string {
	return `${endpointId}\u0000${routeId}`;
}

function createOutboundRouteKey(sessionId: string, endpointId: string): string {
	return `${sessionId}\u0000${endpointId}`;
}

export class ServiceRoutes {
	private readonly sessions = new Map<string, Session>();
	private readonly interactiveRoutes = new Map<string, string>();
	private readonly cronRoutes = new Map<string, string>();
	private readonly outboundRoutes = new Map<string, SessionDelivery>();
	private readonly sessionRouteIds = new Map<
		string,
		Map<string, Set<string>>
	>();
	private readonly activeInteractiveContexts = new Map<
		string,
		{ endpointId: string; routeId: string }
	>();

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
		routeId: string,
		sessionId: string
	): () => void {
		const routeKey = createInteractiveRouteKey(endpointId, routeId);
		const existingSessionId = this.interactiveRoutes.get(routeKey);
		if (existingSessionId && existingSessionId !== sessionId) {
			throw new Error(
				`Duplicate interactive route for endpoint ${endpointId} and route ${routeId}`
			);
		}
		this.interactiveRoutes.set(routeKey, sessionId);
		let endpointRouteIds = this.sessionRouteIds.get(sessionId);
		if (!endpointRouteIds) {
			endpointRouteIds = new Map<string, Set<string>>();
			this.sessionRouteIds.set(sessionId, endpointRouteIds);
		}
		let routeIds = endpointRouteIds.get(endpointId);
		if (!routeIds) {
			routeIds = new Set<string>();
			endpointRouteIds.set(endpointId, routeIds);
		}
		routeIds.add(routeId);
		return () => {
			if (this.interactiveRoutes.get(routeKey) === sessionId) {
				this.interactiveRoutes.delete(routeKey);
			}
			const sessionEndpointRouteIds = this.sessionRouteIds.get(sessionId);
			const sessionRouteIdsForEndpoint =
				sessionEndpointRouteIds?.get(endpointId);
			sessionRouteIdsForEndpoint?.delete(routeId);
			if (sessionRouteIdsForEndpoint?.size === 0) {
				sessionEndpointRouteIds?.delete(endpointId);
			}
			if (sessionEndpointRouteIds?.size === 0) {
				this.sessionRouteIds.delete(sessionId);
			}
		};
	}

	public registerCronRoute(chatId: string, sessionId: string): () => void {
		const existingSessionId = this.cronRoutes.get(chatId);
		if (existingSessionId && existingSessionId !== sessionId) {
			throw new Error(`Duplicate cron route for chat ${chatId}`);
		}
		this.cronRoutes.set(chatId, sessionId);
		return () => {
			if (this.cronRoutes.get(chatId) === sessionId) {
				this.cronRoutes.delete(chatId);
			}
		};
	}

	public registerOutboundRoute(
		endpointId: string,
		sessionId: string,
		delivery: SessionDelivery
	): () => void {
		const routeKey = createOutboundRouteKey(sessionId, endpointId);
		const existingDelivery = this.outboundRoutes.get(routeKey);
		if (existingDelivery) {
			throw new Error(
				`Duplicate outbound route for session ${sessionId} on endpoint ${endpointId}`
			);
		}
		this.outboundRoutes.set(routeKey, delivery);
		return () => {
			if (this.outboundRoutes.get(routeKey) === delivery) {
				this.outboundRoutes.delete(routeKey);
			}
		};
	}

	public async dispatchInteractive(
		endpointId: string,
		routeId: string,
		input: InteractiveInput
	): Promise<void> {
		const sessionId = this.interactiveRoutes.get(
			createInteractiveRouteKey(endpointId, routeId)
		);
		if (!sessionId) {
			throw new Error(
				`No session configured for route ${routeId} on endpoint ${endpointId}`
			);
		}
		const previousContext = this.activeInteractiveContexts.get(sessionId);
		this.activeInteractiveContexts.set(sessionId, { endpointId, routeId });
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
		chatId: string,
		input: CronInput
	): Promise<PhiMessage[]> {
		const sessionId = this.cronRoutes.get(chatId);
		if (!sessionId) {
			throw new Error(`No cron session configured for chat ${chatId}`);
		}
		return await this.requireSession(sessionId).submitCron(input);
	}

	public async deliverOutbound(
		sessionId: string,
		message: PhiMessage
	): Promise<void> {
		const context =
			this.activeInteractiveContexts.get(sessionId) ??
			this.resolveDefaultOutboundContext(sessionId);
		const delivery = this.outboundRoutes.get(
			createOutboundRouteKey(sessionId, context.endpointId)
		);
		if (!delivery) {
			throw new Error(
				`No outbound route configured for session ${sessionId}`
			);
		}
		await delivery.deliver(context.routeId, message);
	}

	private resolveDefaultOutboundContext(sessionId: string): {
		endpointId: string;
		routeId: string;
	} {
		const endpointRouteIds = this.sessionRouteIds.get(sessionId);
		if (!endpointRouteIds || endpointRouteIds.size === 0) {
			throw new Error(
				`No outbound route configured for session ${sessionId}`
			);
		}
		if (endpointRouteIds.size !== 1) {
			throw new Error(
				`No active outbound route for session ${sessionId}`
			);
		}
		const firstEntry = endpointRouteIds.entries().next().value;
		if (!firstEntry) {
			throw new Error(
				`No active outbound route for session ${sessionId}`
			);
		}
		const endpointId = firstEntry[0];
		const routeIds = firstEntry[1];
		if (routeIds.size !== 1) {
			throw new Error(
				`No active outbound route for session ${sessionId}`
			);
		}
		const routeId = routeIds.values().next().value;
		if (!routeId) {
			throw new Error(
				`No active outbound route for session ${sessionId}`
			);
		}
		return { endpointId, routeId };
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
