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
	deliver(message: PhiMessage): Promise<void>;
}

function createInteractiveRouteKey(
	endpointId: string,
	routeId: string
): string {
	return `${endpointId}\u0000${routeId}`;
}

export class ServiceRoutes {
	private readonly sessions = new Map<string, Session>();
	private readonly interactiveRoutes = new Map<string, string>();
	private readonly cronRoutes = new Map<string, string>();
	private readonly outboundRoutes = new Map<string, SessionDelivery>();

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
		return () => {
			if (this.interactiveRoutes.get(routeKey) === sessionId) {
				this.interactiveRoutes.delete(routeKey);
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
		sessionId: string,
		delivery: SessionDelivery
	): () => void {
		const existingDelivery = this.outboundRoutes.get(sessionId);
		if (existingDelivery) {
			throw new Error(
				`Duplicate outbound route for session ${sessionId}`
			);
		}
		this.outboundRoutes.set(sessionId, delivery);
		return () => {
			if (this.outboundRoutes.get(sessionId) === delivery) {
				this.outboundRoutes.delete(sessionId);
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
		await this.requireSession(sessionId).submitInteractive(input);
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
		const delivery = this.outboundRoutes.get(sessionId);
		if (!delivery) {
			throw new Error(
				`No outbound route configured for session ${sessionId}`
			);
		}
		await delivery.deliver(message);
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
