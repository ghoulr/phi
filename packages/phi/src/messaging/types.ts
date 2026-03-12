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
	mentions?: PhiMessageMention[];
}
