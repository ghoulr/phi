import type { PhiMessageMention } from "@phi/messaging/types";

export interface PhiTurnContext {
	sender?: PhiMessageMention;
}
