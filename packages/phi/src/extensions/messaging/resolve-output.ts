import type { PhiMessage } from "@phi/messaging/types";

import { isNoReplyToken } from "@phi/extensions/messaging/tokens";

export interface ResolvePhiMessagingOutputParams {
	assistantText: string | undefined;
	deferredMessage?: PhiMessage;
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
}): PhiMessage {
	return {
		text: params.text,
		attachments: params.deferredMessage?.attachments ?? [],
		mentions: params.deferredMessage?.mentions,
	};
}

export function resolvePhiMessagingOutput(
	params: ResolvePhiMessagingOutputParams
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
		}),
	];
}
