export const NO_REPLY_TOKEN = "NO_REPLY";

export function isNoReplyToken(text: string | undefined): boolean {
	return text?.trim() === NO_REPLY_TOKEN;
}
