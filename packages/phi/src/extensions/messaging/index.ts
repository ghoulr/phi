import { existsSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
} from "@mariozechner/pi-coding-agent";

import { getPhiLogger } from "@phi/core/logger";
import { normalizeUnknownError } from "@phi/core/user-error";
import { labelInlineExtensionFactory } from "@phi/core/inline-extension-labels";
import { resolvePhiMessagingOutput } from "@phi/extensions/messaging/resolve-output";
import { resolveSenderMentionFromCurrentTurn } from "@phi/extensions/messaging/sender";
import { NO_REPLY_TOKEN } from "@phi/extensions/messaging/tokens";
import {
	extractLastAssistantVisibleOutput,
	type AssistantVisibleOutputSource,
} from "@phi/messaging/assistant-output";
import type {
	PhiMessage,
	PhiMessageAttachment,
	PhiMessageMention,
} from "@phi/messaging/types";

const log = getPhiLogger("messaging");

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

interface MessagingRunState {
	deferredMessage?: PhiMessage;
	sender?: PhiMessageMention;
}

export interface CreatePhiMessagingExtensionDependencies {
	deliverMessage(
		message: PhiMessage,
		phase: "instant" | "final"
	): Promise<void>;
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

function requireCurrentSenderMention(
	currentRun: MessagingRunState | undefined
): PhiMessageMention {
	const sender = currentRun?.sender;
	if (!sender) {
		throw new Error("Current turn has no sender to mention.");
	}
	return sender;
}

function resolvePhiMessage(
	ctx: ExtensionContext,
	input: SendInput,
	currentRun: MessagingRunState | undefined
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
			? [requireCurrentSenderMention(currentRun)]
			: undefined;
	return { text, attachments, mentions };
}

function ensureRunState(
	currentRun: MessagingRunState | undefined
): MessagingRunState {
	return currentRun ?? {};
}

function stageDeferredMessage(
	currentRun: MessagingRunState,
	message: PhiMessage
): void {
	if (currentRun.deferredMessage) {
		throw new Error("Only one deferred send is allowed per turn.");
	}
	currentRun.deferredMessage = message;
}

function createDeliveryFields(
	message: PhiMessage,
	phase: "instant" | "final",
	source: AssistantVisibleOutputSource
): Record<string, number | string | boolean | undefined> {
	return {
		phase,
		source,
		hasText: typeof message.text === "string",
		textLength: message.text?.length,
		attachmentCount: message.attachments.length,
		mentionCount: message.mentions?.length,
	};
}

async function deliverMessageWithLogging(
	dependencies: CreatePhiMessagingExtensionDependencies,
	message: PhiMessage,
	phase: "instant" | "final",
	source: AssistantVisibleOutputSource
): Promise<void> {
	const fields = createDeliveryFields(message, phase, source);
	log.info("messaging.outbound.delivering", fields);
	try {
		await dependencies.deliverMessage(message, phase);
		log.info("messaging.outbound.delivered", fields);
	} catch (error: unknown) {
		log.error("messaging.outbound.failed", {
			...fields,
			err: normalizeUnknownError(error),
		});
		throw error;
	}
}

async function executeSendTool(
	_toolCallId: string,
	input: SendInput,
	_signal: AbortSignal | undefined,
	_onUpdate: unknown,
	ctx: ExtensionContext | undefined,
	currentRun: MessagingRunState | undefined,
	dependencies: CreatePhiMessagingExtensionDependencies
): Promise<{
	result: AgentToolResult<Record<string, unknown>>;
	nextRun: MessagingRunState;
}> {
	if (!ctx) {
		throw new Error("send requires an extension context");
	}

	const run = ensureRunState(currentRun);
	const message = resolvePhiMessage(ctx, input, run);
	if (input.instant === true) {
		await deliverMessageWithLogging(
			dependencies,
			message,
			"instant",
			"assistant"
		);
		return {
			result: {
				content: [
					{
						type: "text",
						text: "Message sent immediately. End with exact NO_REPLY if this already delivered everything.",
					},
				],
				details: { instant: true },
			},
			nextRun: run,
		};
	}

	stageDeferredMessage(run, message);
	return {
		result: {
			content: [
				{
					type: "text",
					text: "Deferred message staged for agent run end.",
				},
			],
			details: { instant: false },
		},
		nextRun: run,
	};
}

export function createPhiMessagingExtension(
	dependencies: CreatePhiMessagingExtensionDependencies
): ExtensionFactory {
	return labelInlineExtensionFactory("phi/messaging", (pi: ExtensionAPI) => {
		let currentRun: MessagingRunState | undefined;

		pi.on("agent_start", async (_event, ctx) => {
			currentRun = {
				sender: resolveSenderMentionFromCurrentTurn(ctx),
			};
		});

		pi.on("agent_end", async (event) => {
			const run = currentRun;
			currentRun = undefined;
			const assistantOutput = extractLastAssistantVisibleOutput(
				event.messages
			);
			const outboundMessages = resolvePhiMessagingOutput({
				assistantText: assistantOutput?.text,
				deferredMessage: run?.deferredMessage,
			});
			log.info("messaging.agent_end.resolved", {
				source: assistantOutput?.source,
				assistantTextLength: assistantOutput?.text.length,
				hasDeferredMessage: Boolean(run?.deferredMessage),
				outboundMessageCount: outboundMessages.length,
			});
			for (const message of outboundMessages) {
				await deliverMessageWithLogging(
					dependencies,
					message,
					"final",
					assistantOutput?.source ?? "assistant"
				);
			}
		});

		pi.registerTool({
			name: "send",
			label: "send",
			description:
				"Send a user-visible message immediately or stage it for agent run end.",
			promptGuidelines: [
				"Use send for attachments, mentions, or explicit user-visible delivery.",
				"Use send(instant: true) to send a separate message immediately.",
				"Without instant: true, send stages one deferred message for agent run end.",
				`If send(instant: true) already delivered everything the user should see, end with exact ${NO_REPLY_TOKEN}.`,
				`If the deferred send should be the only visible output, end with exact ${NO_REPLY_TOKEN}.`,
			],
			parameters: SendSchema,
			execute: async (toolCallId, params, signal, onUpdate, ctx) => {
				const execution = await executeSendTool(
					toolCallId,
					params,
					signal,
					onUpdate,
					ctx,
					currentRun,
					dependencies
				);
				currentRun = execution.nextRun;
				return execution.result;
			},
		});
	});
}
