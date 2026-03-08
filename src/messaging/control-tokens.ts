export const NO_REPLY_TOKEN = "NO_REPLY";
export const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";

export function isNoReplyToken(text: string | undefined): boolean {
	return text?.trim() === NO_REPLY_TOKEN;
}
