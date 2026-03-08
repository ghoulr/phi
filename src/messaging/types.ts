export interface PhiMessageAttachment {
	path: string;
	name: string;
}

export interface PhiMessageMention {
	userId: string;
	username?: string;
	displayName?: string;
}

export interface PhiMessage {
	text?: string;
	attachments: PhiMessageAttachment[];
	replyToMessageId?: string;
	mentions?: PhiMessageMention[];
}

export interface PhiSendInput {
	text?: string;
	attachments?: PhiMessageAttachment[];
	instant?: boolean;
	mentionSender?: boolean;
}
