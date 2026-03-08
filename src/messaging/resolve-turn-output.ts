import { isNoReplyToken } from "@phi/messaging/control-tokens";
import type { PhiTurnContext } from "@phi/messaging/turn-context";
import type { PhiMessage } from "@phi/messaging/types";

export interface ResolvePhiTurnOutputParams {
	assistantText: string | undefined;
	deferredMessage?: PhiMessage;
	turnContext?: PhiTurnContext;
}

function normalizeText(text: string | undefined): string | undefined {
	const normalized = text?.trim();
	if (!normalized) {
		return undefined;
	}
	return normalized;
}

function mergeMessageText(
	assistantText: string | undefined,
	deferredText: string | undefined
): string | undefined {
	if (assistantText && deferredText) {
		return `${assistantText}\n\n${deferredText}`;
	}
	return assistantText ?? deferredText;
}

function createResolvedMessage(params: {
	text: string | undefined;
	deferredMessage?: PhiMessage;
	turnContext?: PhiTurnContext;
}): PhiMessage {
	return applyPhiTurnContext(
		{
			text: params.text,
			attachments: params.deferredMessage?.attachments ?? [],
			mentions: params.deferredMessage?.mentions,
			replyToMessageId: params.deferredMessage?.replyToMessageId,
		},
		params.turnContext
	);
}

export function applyPhiTurnContext(
	message: PhiMessage,
	turnContext: PhiTurnContext | undefined
): PhiMessage {
	if (!turnContext?.replyToMessageId) {
		return message;
	}
	return {
		...message,
		replyToMessageId:
			message.replyToMessageId ?? turnContext.replyToMessageId,
	};
}

export function resolvePhiTurnOutput(
	params: ResolvePhiTurnOutputParams
): PhiMessage[] {
	const assistantText = normalizeText(params.assistantText);
	const deferredText = normalizeText(params.deferredMessage?.text);
	const deferredAttachments = params.deferredMessage?.attachments ?? [];

	if (isNoReplyToken(assistantText)) {
		if (!deferredText && deferredAttachments.length === 0) {
			return [];
		}
		return [
			createResolvedMessage({
				text: deferredText,
				deferredMessage: params.deferredMessage,
				turnContext: params.turnContext,
			}),
		];
	}

	const mergedText = mergeMessageText(assistantText, deferredText);
	if (!mergedText && deferredAttachments.length === 0) {
		return [];
	}

	return [
		createResolvedMessage({
			text: mergedText,
			deferredMessage: params.deferredMessage,
			turnContext: params.turnContext,
		}),
	];
}
