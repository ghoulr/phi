import { existsSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
} from "@mariozechner/pi-coding-agent";
import { labelInlineExtensionFactory } from "@phi/core/inline-extension-labels";
import { NO_REPLY_TOKEN } from "@phi/messaging/control-tokens";
import type { PhiMessagingSessionState } from "@phi/messaging/session-state";
import type { PhiMessage, PhiMessageAttachment } from "@phi/messaging/types";

const SendAttachmentSchema = Type.Object({
	path: Type.String({ description: "Path to a file inside the workspace." }),
	name: Type.Optional(
		Type.String({
			description: "Optional display name for the attachment.",
		})
	),
});

const SendSchema = Type.Object({
	text: Type.Optional(Type.String({ description: "Message text." })),
	attachments: Type.Optional(
		Type.Array(SendAttachmentSchema, {
			description: "Files to include in the message.",
		})
	),
	instant: Type.Optional(
		Type.Boolean({
			description: "Send immediately when true. Defaults to false.",
		})
	),
	mentionSender: Type.Optional(
		Type.Boolean({
			description: "Mention the current sender when true.",
		})
	),
});

type SendInput = Static<typeof SendSchema>;

export interface CreatePhiMessagingExtensionDependencies {
	state: PhiMessagingSessionState;
	deliverMessage(message: PhiMessage): Promise<void>;
}

function buildPhiMessageGuidance(): string {
	return [
		"- End with exact `NO_REPLY` when `send()` already delivered everything the user should see.",
		"- `NO_REPLY` suppresses the final assistant text.",
	].join("\n");
}

function resolveAttachmentPath(
	ctx: ExtensionContext,
	attachment: NonNullable<SendInput["attachments"]>[number]
): PhiMessageAttachment {
	const filePath = resolve(ctx.cwd, attachment.path);
	const relativePath = relative(ctx.cwd, filePath);
	if (relativePath === ".." || relativePath.startsWith(`..${"/"}`)) {
		throw new Error(
			`Attachment path must stay inside the workspace: ${attachment.path}`
		);
	}

	if (!existsSync(filePath)) {
		throw new Error(`Attachment file not found: ${attachment.path}`);
	}

	return {
		path: filePath,
		name: attachment.name?.trim() || basename(filePath),
	};
}

function resolvePhiMessage(
	ctx: ExtensionContext,
	input: SendInput,
	state: PhiMessagingSessionState
): PhiMessage {
	const text = input.text?.trim() || undefined;
	const attachments = (input.attachments ?? []).map((attachment) =>
		resolveAttachmentPath(ctx, attachment)
	);
	if (!text && attachments.length === 0) {
		throw new Error("send requires text or at least one attachment");
	}
	const mentions =
		input.mentionSender === true
			? [resolveCurrentSenderMention(state)]
			: undefined;
	return { text, attachments, mentions };
}

function resolveCurrentSenderMention(
	state: PhiMessagingSessionState
): NonNullable<PhiMessage["mentions"]>[number] {
	const sender = state.getTurnContext()?.sender;
	if (!sender) {
		throw new Error("Current turn has no sender to mention.");
	}
	return sender;
}

async function executeSendTool(
	_toolCallId: string,
	input: SendInput,
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	ctx: ExtensionContext | undefined,
	dependencies: CreatePhiMessagingExtensionDependencies
): Promise<AgentToolResult<Record<string, unknown>>> {
	if (!ctx) {
		throw new Error("send requires an extension context");
	}

	const message = resolvePhiMessage(ctx, input, dependencies.state);
	if (input.instant === true) {
		await dependencies.deliverMessage(message);
		return {
			content: [
				{
					type: "text",
					text: "Message sent immediately. End with exact NO_REPLY if this already delivered everything.",
				},
			],
			details: { instant: true },
		};
	}

	dependencies.state.setDeferredMessage(message);
	return {
		content: [
			{
				type: "text",
				text: "Deferred message staged for agent run end.",
			},
		],
		details: { instant: false },
	};
}

export function buildPhiMessagingEventText(): string {
	return buildPhiMessageGuidance();
}

export function createPhiMessagingExtension(
	dependencies: CreatePhiMessagingExtensionDependencies
): ExtensionFactory {
	return labelInlineExtensionFactory("phi/messaging", (pi: ExtensionAPI) => {
		pi.registerTool({
			name: "send",
			label: "send",
			description:
				"Send a user-visible message immediately or stage it for agent run end.",
			promptGuidelines: [
				"Use send for attachments or explicit user-visible delivery.",
				"Use mentionSender to mention the current sender when needed.",
				`If send(instant: true) already delivered everything the user should see, end with exact ${NO_REPLY_TOKEN}.`,
			],
			parameters: SendSchema,
			execute: async (toolCallId, params, signal, onUpdate, ctx) =>
				await executeSendTool(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
					dependencies
				),
		});
	});
}
