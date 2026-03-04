import { sanitizeOutboundText } from "@phi/core/message-text";

const FALLBACK_USER_ERROR_MESSAGE = "Unknown error";

export function normalizeUnknownError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}
	return new Error(String(error));
}

export function formatUserFacingErrorMessage(error: unknown): string {
	const message = normalizeUnknownError(error).message;
	const sanitized = sanitizeOutboundText(message).trim();
	if (sanitized.length === 0) {
		return FALLBACK_USER_ERROR_MESSAGE;
	}
	return sanitized;
}
