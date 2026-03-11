import { readFileSync } from "node:fs";

import type {
	AssistantMessage,
	ImageContent,
	TextContent,
} from "@mariozechner/pi-ai";
import {
	SessionManager,
	type AgentSession,
	type AgentSessionEvent,
	type ExtensionFactory,
} from "@mariozechner/pi-coding-agent";

import type { ChatExecutor } from "@phi/core/chat-executor";
import type { PhiConfig } from "@phi/core/config";
import { getPhiLogger } from "@phi/core/logger";
import { sanitizeInboundText } from "@phi/core/message-text";
import {
	createPhiAgentSession,
	type ChatSessionRuntime,
} from "@phi/core/runtime";
import { createPhiMessagingExtension } from "@phi/extensions/messaging";
import {
	extractLastAssistantText,
	resolvePlainAssistantMessage,
} from "@phi/messaging/assistant-output";
import {
	appendPhiSystemReminderToUserContent,
	buildPhiSystemReminder,
} from "@phi/messaging/system-reminder";
import type { PhiMessage } from "@phi/messaging/types";
import type {
	ChatHandlerCronInput,
	ChatHandlerInteractiveAttachment,
	ChatHandlerInteractiveInput,
	ServiceRoutes,
} from "@phi/services/routes";

const TYPING_INTERVAL_MS = 2500;
const log = getPhiLogger("chat-handler");

const EMPTY_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

interface TypingNotifier {
	notify(): void;
	stop(): void;
}

interface PendingSubmit {
	typingNotifier: TypingNotifier;
}

interface ChatSessionBridgeDependencies {
	messagingManaged: boolean;
	onResolved(messages: PhiMessage[]): Promise<void>;
}

interface ChatSessionBridgeSubmitParams {
	content: string | (TextContent | ImageContent)[];
	sendTyping(): Promise<unknown>;
}

class AsyncLock {
	private tail = Promise.resolve();

	public async run<T>(task: () => Promise<T>): Promise<T> {
		let release: (() => void) | undefined;
		const current = this.tail;
		this.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await current;
		try {
			return await task();
		} finally {
			release?.();
		}
	}
}

function createTypingNotifier(
	sendTyping: () => Promise<unknown>
): TypingNotifier {
	let stopped = false;
	let sending = false;
	let lastSentAt = 0;

	return {
		notify(): void {
			if (stopped || sending) {
				return;
			}
			if (Date.now() - lastSentAt < TYPING_INTERVAL_MS) {
				return;
			}

			sending = true;
			void sendTyping().then(
				() => {
					sending = false;
					lastSentAt = Date.now();
				},
				() => {
					sending = false;
					lastSentAt = Date.now();
				}
			);
		},
		stop(): void {
			stopped = true;
		},
	};
}

function shouldShowTypingForEvent(event: AgentSessionEvent): boolean {
	if (event.type !== "message_update") {
		return false;
	}
	if (event.message.role !== "assistant") {
		return false;
	}

	switch (event.assistantMessageEvent.type) {
		case "thinking_start":
		case "thinking_delta":
		case "thinking_end":
		case "text_start":
		case "text_delta":
		case "text_end":
			return true;
		default:
			return false;
	}
}

function sanitizeInboundTextOrThrow(text: string): string {
	const result = sanitizeInboundText(text);
	if (!result.ok) {
		throw new Error(result.error);
	}
	return result.message;
}

function buildInteractiveAttachmentText(
	attachments: ChatHandlerInteractiveAttachment[]
): string[] {
	if (attachments.length === 0) {
		return [];
	}
	return [
		"User sent attachments:",
		...attachments.map((attachment) => `- ${attachment.path}`),
	];
}

function resolveInteractiveAttachmentMimeType(
	attachment: ChatHandlerInteractiveAttachment
): string | undefined {
	return attachment.mimeType ?? Bun.file(attachment.path).type ?? undefined;
}

function isInteractiveImageAttachment(
	attachment: ChatHandlerInteractiveAttachment
): boolean {
	const mimeType = resolveInteractiveAttachmentMimeType(attachment);
	return typeof mimeType === "string" && mimeType.startsWith("image/");
}

function buildInteractiveInputText(input: ChatHandlerInteractiveInput): string {
	const lines: string[] = [];
	const normalizedText = input.text?.trim();
	if (normalizedText) {
		lines.push(normalizedText);
	}
	const imageCount = input.attachments.filter((attachment) =>
		isInteractiveImageAttachment(attachment)
	).length;
	if (imageCount > 0) {
		lines.push(`User sent ${String(imageCount)} image attachment(s).`);
	}
	lines.push(...buildInteractiveAttachmentText(input.attachments));
	if (lines.length === 0) {
		throw new Error("Inbound message has no supported content.");
	}
	return lines.join("\n\n");
}

function createImageContent(
	attachment: ChatHandlerInteractiveAttachment
): ImageContent {
	const mimeType = resolveInteractiveAttachmentMimeType(attachment);
	if (!mimeType || !mimeType.startsWith("image/")) {
		throw new Error(`Attachment is not an image: ${attachment.path}`);
	}
	return {
		type: "image",
		mimeType,
		data: Buffer.from(readFileSync(attachment.path)).toString("base64"),
	};
}

function buildInteractiveAgentContent(
	input: ChatHandlerInteractiveInput
): string | (TextContent | ImageContent)[] {
	const reminder = buildPhiSystemReminder(input.metadata);
	if (input.attachments.length === 0) {
		const normalizedText = input.text?.trim();
		if (!normalizedText) {
			throw new Error("Inbound message has no supported content.");
		}
		return appendPhiSystemReminderToUserContent(
			sanitizeInboundTextOrThrow(normalizedText),
			reminder
		);
	}
	const sanitizedText = sanitizeInboundTextOrThrow(
		buildInteractiveInputText(input)
	);
	const imageContents = input.attachments
		.filter((attachment) => isInteractiveImageAttachment(attachment))
		.map((attachment) => createImageContent(attachment));
	if (imageContents.length === 0) {
		return appendPhiSystemReminderToUserContent(sanitizedText, reminder);
	}
	return appendPhiSystemReminderToUserContent(
		[{ type: "text", text: sanitizedText }, ...imageContents],
		reminder
	);
}

function buildCronAgentContent(input: ChatHandlerCronInput): string {
	const text = input.text.trim();
	if (!text) {
		throw new Error("Cron trigger has no content.");
	}
	return text;
}

function createPendingSubmit(
	params: Pick<ChatSessionBridgeSubmitParams, "sendTyping">
): PendingSubmit {
	return {
		typingNotifier: createTypingNotifier(params.sendTyping),
	};
}

class ChatSessionBridge {
	private session: AgentSession | undefined;
	private unsubscribe: (() => void) | undefined;
	private readonly submitLock = new AsyncLock();
	private readonly pendingSubmissions: PendingSubmit[] = [];
	private eventQueue = Promise.resolve();

	public constructor(
		private readonly runtime: ChatSessionRuntime<AgentSession>,
		private readonly chatId: string,
		private readonly dependencies: ChatSessionBridgeDependencies
	) {}

	public async submit(params: ChatSessionBridgeSubmitParams): Promise<void> {
		const submit = createPendingSubmit(params);
		let session: AgentSession | undefined;
		let sendPromise: Promise<void> | undefined;

		await this.submitLock.run(async () => {
			session = await this.getOrCreateSession();
			this.pendingSubmissions.push(submit);
			submit.typingNotifier.notify();
			if (session.isStreaming) {
				log.debug("chat-handler.interactive.steer", {
					chatId: this.chatId,
					pendingSubmitCount: this.pendingSubmissions.length,
				});
				sendPromise = session.sendUserMessage(params.content, {
					deliverAs: "steer",
				});
				return;
			}
			log.debug("chat-handler.interactive.submit", {
				chatId: this.chatId,
				pendingSubmitCount: this.pendingSubmissions.length,
			});
			sendPromise = session.sendUserMessage(params.content);
		});

		if (!session || !sendPromise) {
			throw new Error(`Chat session ${this.chatId} was not prepared.`);
		}

		try {
			await sendPromise;
			this.removePendingSubmit(submit);
		} catch (error: unknown) {
			this.handleSubmitFailure(submit);
			throw error;
		}
	}

	public invalidate(): void {
		this.detachSession();
		this.runtime.disposeSession(this.chatId);
	}

	public dispose(): void {
		this.invalidate();
		this.resetPendingSubmissions();
	}

	private async getOrCreateSession(): Promise<AgentSession> {
		const session = await this.runtime.getOrCreateSession(this.chatId);
		if (session === this.session) {
			return session;
		}
		this.attachSession(session);
		return session;
	}

	private attachSession(session: AgentSession): void {
		this.detachSession();
		this.session = session;
		this.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
			this.eventQueue = this.eventQueue.then(
				async () => await this.handleSessionEvent(event),
				async () => await this.handleSessionEvent(event)
			);
		});
	}

	private detachSession(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.session = undefined;
	}

	private async handleSessionEvent(event: AgentSessionEvent): Promise<void> {
		if (shouldShowTypingForEvent(event)) {
			this.pendingSubmissions.at(-1)?.typingNotifier.notify();
			return;
		}
		if (event.type !== "agent_end") {
			return;
		}
		if (this.dependencies.messagingManaged) {
			return;
		}
		await this.dependencies.onResolved(
			resolvePlainAssistantMessage(
				extractLastAssistantText(event.messages)
			)
		);
	}

	private removePendingSubmit(submit: PendingSubmit): void {
		submit.typingNotifier.stop();
		const index = this.pendingSubmissions.indexOf(submit);
		if (index !== -1) {
			this.pendingSubmissions.splice(index, 1);
		}
	}

	private handleSubmitFailure(submit: PendingSubmit): void {
		const index = this.pendingSubmissions.lastIndexOf(submit);
		if (index !== -1) {
			this.pendingSubmissions.splice(index, 1);
		}
		submit.typingNotifier.stop();
	}

	private resetPendingSubmissions(): void {
		for (const submit of this.pendingSubmissions) {
			submit.typingNotifier.stop();
		}
		this.pendingSubmissions.length = 0;
	}
}

function getLastAssistantMessage(
	session: AgentSession
): AssistantMessage | undefined {
	return session.messages
		.slice()
		.reverse()
		.find(
			(message): message is AssistantMessage =>
				message.role === "assistant"
		);
}

function resolvePublishedAssistantText(
	outboundMessages: PhiMessage[]
): string | undefined {
	return outboundMessages
		.map((message) => message.text?.trim())
		.filter((text): text is string => Boolean(text))
		.at(-1);
}

function createPublishedAssistantMessage(
	assistantMessage: AssistantMessage | undefined,
	assistantText: string | undefined
): AssistantMessage | undefined {
	if (!assistantMessage || !assistantText) {
		return undefined;
	}
	return {
		...assistantMessage,
		content: [{ type: "text", text: assistantText }],
		timestamp: Date.now(),
	};
}

function createAssistantErrorMessage(
	session: AgentSession,
	text: string
): AssistantMessage {
	const model = session.model;
	if (!model) {
		throw new Error("Cannot publish cron error without an active model.");
	}

	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: EMPTY_USAGE,
		stopReason: "error",
		errorMessage: text,
		timestamp: Date.now(),
	};
}

function createInteractiveMessagingExtensionFactories(
	chatId: string,
	routes: ServiceRoutes
): ExtensionFactory[] {
	return [
		createPhiMessagingExtension({
			deliverMessage: async (message) => {
				await routes.deliverOutbound(chatId, message);
			},
		}),
	];
}

function createCronMessagingExtensionFactories(params: {
	chatId: string;
	routes: ServiceRoutes;
	outboundMessages: PhiMessage[];
}): ExtensionFactory[] {
	return [
		createPhiMessagingExtension({
			deliverMessage: async (message, phase) => {
				if (phase === "instant") {
					await params.routes.deliverOutbound(params.chatId, message);
					return;
				}
				params.outboundMessages.push(message);
			},
		}),
	];
}

export interface ChatHandler {
	submitInteractive(input: ChatHandlerInteractiveInput): Promise<void>;
	submitCron(input: ChatHandlerCronInput): Promise<PhiMessage[]>;
	invalidate(): void;
	dispose(): void;
}

export interface PiChatHandlerDependencies {
	createCronSession?: typeof createPhiAgentSession;
	messagingManaged?: boolean;
}

export interface CreatePiChatHandlerParams {
	chatId: string;
	phiConfig: PhiConfig;
	runtime: ChatSessionRuntime<AgentSession>;
	chatExecutor: ChatExecutor;
	routes: ServiceRoutes;
	dependencies?: PiChatHandlerDependencies;
}

export function createServiceSessionExtensionFactories(
	chatId: string,
	routes: ServiceRoutes
): ExtensionFactory[] {
	return createInteractiveMessagingExtensionFactories(chatId, routes);
}

export class PiChatHandler implements ChatHandler {
	private readonly bridge: ChatSessionBridge;
	private readonly createCronSession: typeof createPhiAgentSession;

	public constructor(private readonly params: CreatePiChatHandlerParams) {
		this.createCronSession =
			params.dependencies?.createCronSession ?? createPhiAgentSession;
		this.bridge = new ChatSessionBridge(params.runtime, params.chatId, {
			messagingManaged: params.dependencies?.messagingManaged ?? true,
			onResolved: async (messages) => {
				for (const message of messages) {
					await params.routes.deliverOutbound(params.chatId, message);
				}
			},
		});
	}

	public async submitInteractive(
		input: ChatHandlerInteractiveInput
	): Promise<void> {
		await this.bridge.submit({
			content: buildInteractiveAgentContent(input),
			sendTyping: input.sendTyping,
		});
	}

	public async submitCron(
		input: ChatHandlerCronInput
	): Promise<PhiMessage[]> {
		const outboundMessages: PhiMessage[] = [];
		const session = await this.createCronSession(
			this.params.chatId,
			this.params.phiConfig,
			{
				sessionManager: SessionManager.inMemory(),
				extensionFactories: createCronMessagingExtensionFactories({
					chatId: this.params.chatId,
					routes: this.params.routes,
					outboundMessages,
				}),
			}
		);

		try {
			await session.sendUserMessage(buildCronAgentContent(input));
			await this.publishCronResult(session, outboundMessages);
			return outboundMessages;
		} catch (error: unknown) {
			await this.publishCronError(
				error instanceof Error ? error.message : String(error)
			);
			throw error;
		} finally {
			session.dispose();
		}
	}

	public invalidate(): void {
		this.bridge.invalidate();
	}

	public dispose(): void {
		this.bridge.dispose();
	}

	private async publishCronResult(
		session: AgentSession,
		outboundMessages: PhiMessage[]
	): Promise<void> {
		const assistantMessage = createPublishedAssistantMessage(
			getLastAssistantMessage(session),
			resolvePublishedAssistantText(outboundMessages)
		);
		await this.params.chatExecutor.run(this.params.chatId, async () => {
			if (assistantMessage) {
				const persistentSession =
					await this.params.runtime.getOrCreateSession(
						this.params.chatId
					);
				persistentSession.sessionManager.appendMessage(
					assistantMessage
				);
				persistentSession.agent.replaceMessages(
					persistentSession.sessionManager.buildSessionContext()
						.messages
				);
			}
			for (const message of outboundMessages) {
				await this.params.routes.deliverOutbound(
					this.params.chatId,
					message
				);
			}
		});
	}

	private async publishCronError(message: string): Promise<void> {
		const errorText = `Cron job failed: ${message}`;
		await this.params.chatExecutor.run(this.params.chatId, async () => {
			const session = await this.params.runtime.getOrCreateSession(
				this.params.chatId
			);
			const assistantMessage = createAssistantErrorMessage(
				session,
				errorText
			);
			session.sessionManager.appendMessage(assistantMessage);
			session.agent.replaceMessages(
				session.sessionManager.buildSessionContext().messages
			);
			await this.params.routes.deliverOutbound(this.params.chatId, {
				text: errorText,
				attachments: [],
			});
		});
	}
}
