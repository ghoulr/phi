import type { PhiMessageAttachment } from "@phi/messaging/types";

export interface EndpointAttachment {
	path: string;
	name: string;
	mimeType?: string;
}

export interface EndpointInboundContext {
	endpointId: string;
	instanceId: string;
	endpointChatId: string;
	messageId: string;
	text?: string;
	attachments: EndpointAttachment[];
	metadata?: Record<string, unknown>;
	replyToMessageId?: string;
	sendTyping(): Promise<void>;
}

export interface EndpointOutboundMessage {
	text?: string;
	attachments: PhiMessageAttachment[];
	replyToMessageId?: string;
}

export interface EndpointProvider {
	readonly id: string;
	readonly instanceId: string;

	start(): Promise<void>;
	stop(): Promise<void>;
	send(
		endpointChatId: string,
		message: EndpointOutboundMessage
	): Promise<void>;
}
