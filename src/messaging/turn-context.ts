import type { PhiMessageMention } from "@phi/messaging/types";

export interface PhiTurnContext {
	currentMessageId?: string;
	replyToMessageId?: string;
	sender?: PhiMessageMention;
}
