import { readFileSync } from "node:fs";

import type {
	AssistantMessage,
	ImageContent,
	TextContent,
} from "@mariozechner/pi-ai";
import type {
	AgentSession,
	AgentSessionEvent,
	ExtensionFactory,
} from "@mariozechner/pi-coding-agent";

import type { SessionExecutor } from "@phi/core/session-executor";
import type { PhiConfig } from "@phi/core/config";
import type { ChatReloadRegistry } from "@phi/core/reload";
import { getPhiLogger } from "@phi/core/logger";
import { sanitizeInboundText } from "@phi/core/message-text";
import { createPhiAgentSession, type SessionRuntime } from "@phi/core/runtime";
import { createPhiMessagingExtension } from "@phi/extensions/messaging";
import {
	appendPhiSystemReminderToUserContent,
	buildPhiSystemReminder,
} from "@phi/messaging/system-reminder";
import type { PhiMessage } from "@phi/messaging/types";
import type {
	CronInput,
	InteractiveAttachment,
	InteractiveInput,
	ServiceRoutes,
} from "@phi/services/routes";

const TYPING_INTERVAL_MS = 2500;
const log = getPhiLogger("session");

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

interface InteractiveSessionSubmitParams {
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

function buildAttachmentText(attachments: InteractiveAttachment[]): string[] {
	if (attachments.length === 0) {
		return [];
	}
	return [
		"User sent attachments:",
		...attachments.map((attachment) => `- ${attachment.path}`),
	];
}

function resolveAttachmentMimeType(
	attachment: InteractiveAttachment
): string | undefined {
	return attachment.mimeType ?? Bun.file(attachment.path).type ?? undefined;
}

function isImageAttachment(attachment: InteractiveAttachment): boolean {
	const mimeType = resolveAttachmentMimeType(attachment);
	return typeof mimeType === "string" && mimeType.startsWith("image/");
}

function buildInteractiveInputText(input: InteractiveInput): string {
	const lines: string[] = [];
	const normalizedText = input.text?.trim();
	if (normalizedText) {
		lines.push(normalizedText);
	}
	const imageCount = input.attachments.filter((attachment) =>
		isImageAttachment(attachment)
	).length;
	if (imageCount > 0) {
		lines.push(`User sent ${String(imageCount)} image attachment(s).`);
	}
	lines.push(...buildAttachmentText(input.attachments));
	if (lines.length === 0) {
		throw new Error("Inbound message has no supported content.");
	}
	return lines.join("\n\n");
}

function createImageContent(attachment: InteractiveAttachment): ImageContent {
	const mimeType = resolveAttachmentMimeType(attachment);
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
	input: InteractiveInput
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
		.filter((attachment) => isImageAttachment(attachment))
		.map((attachment) => createImageContent(attachment));
	if (imageContents.length === 0) {
		return appendPhiSystemReminderToUserContent(sanitizedText, reminder);
	}
	return appendPhiSystemReminderToUserContent(
		[{ type: "text", text: sanitizedText }, ...imageContents],
		reminder
	);
}

function buildCronAgentContent(input: CronInput): string {
	const text = input.text.trim();
	if (!text) {
		throw new Error("Cron trigger has no content.");
	}
	return text;
}

function createPendingSubmit(
	sendTyping: () => Promise<unknown>
): PendingSubmit {
	return {
		typingNotifier: createTypingNotifier(sendTyping),
	};
}

class InteractiveSession {
	private session: AgentSession | undefined;
	private unsubscribe: (() => void) | undefined;
	private readonly submitLock = new AsyncLock();
	private readonly pendingSubmissions: PendingSubmit[] = [];

	public constructor(
		private readonly runtime: SessionRuntime<AgentSession>,
		private readonly sessionId: string
	) {}

	public async submit(params: InteractiveSessionSubmitParams): Promise<void> {
		const submit = createPendingSubmit(params.sendTyping);
		let session: AgentSession | undefined;
		let sendPromise: Promise<void> | undefined;

		await this.submitLock.run(async () => {
			session = await this.getOrCreateSession();
			this.pendingSubmissions.push(submit);
			submit.typingNotifier.notify();
			if (session.isStreaming) {
				log.debug("session.interactive.steer", {
					sessionId: this.sessionId,
					pendingSubmitCount: this.pendingSubmissions.length,
				});
				sendPromise = session.sendUserMessage(params.content, {
					deliverAs: "steer",
				});
				return;
			}
			log.debug("session.interactive.submit", {
				sessionId: this.sessionId,
				pendingSubmitCount: this.pendingSubmissions.length,
			});
			sendPromise = session.sendUserMessage(params.content);
		});

		if (!session || !sendPromise) {
			throw new Error(`Session ${this.sessionId} was not prepared.`);
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
		this.runtime.disposeSession(this.sessionId);
	}

	public dispose(): void {
		this.invalidate();
		this.resetPendingSubmissions();
	}

	private async getOrCreateSession(): Promise<AgentSession> {
		const session = await this.runtime.getOrCreateSession(this.sessionId);
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
			this.handleSessionEvent(event);
		});
	}

	private detachSession(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.session = undefined;
	}

	private handleSessionEvent(event: AgentSessionEvent): void {
		if (shouldShowTypingForEvent(event)) {
			this.pendingSubmissions.at(-1)?.typingNotifier.notify();
		}
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
	sessionId: string,
	routes: ServiceRoutes
): ExtensionFactory[] {
	return [
		createPhiMessagingExtension({
			deliverMessage: async (message) => {
				await routes.deliverOutbound(sessionId, message);
			},
		}),
	];
}

function createCronMessagingExtensionFactories(params: {
	sessionId: string;
	routes: ServiceRoutes;
	outboundMessages: PhiMessage[];
}): ExtensionFactory[] {
	return [
		createPhiMessagingExtension({
			deliverMessage: async (message, phase) => {
				if (phase === "instant") {
					await params.routes.deliverOutbound(
						params.sessionId,
						message
					);
					return;
				}
				params.outboundMessages.push(message);
			},
		}),
	];
}

export interface Session {
	submitInteractive(input: InteractiveInput): Promise<void>;
	submitCron(input: CronInput): Promise<PhiMessage[]>;
	validateReload(): Promise<string[]>;
	invalidate(): void;
	dispose(): void;
}

export interface PiSessionRuntimeDependencies {
	createCronSession?: typeof createPhiAgentSession;
	createValidationSession?: typeof createPhiAgentSession;
}

export interface CreatePiSessionRuntimeParams {
	sessionId: string;
	chatId: string;
	phiConfig: PhiConfig;
	runtime: SessionRuntime<AgentSession>;
	sessionExecutor: SessionExecutor;
	routes: ServiceRoutes;
	reloadRegistry: ChatReloadRegistry;
	dependencies?: PiSessionRuntimeDependencies;
}

export function createServiceSessionExtensionFactories(
	sessionId: string,
	routes: ServiceRoutes
): ExtensionFactory[] {
	return createInteractiveMessagingExtensionFactories(sessionId, routes);
}

export class PiSessionRuntime implements Session {
	private readonly interactiveSession: InteractiveSession;
	private readonly createCronSession: typeof createPhiAgentSession;
	private readonly createValidationSession: typeof createPhiAgentSession;

	public constructor(private readonly params: CreatePiSessionRuntimeParams) {
		this.createCronSession =
			params.dependencies?.createCronSession ?? createPhiAgentSession;
		this.createValidationSession =
			params.dependencies?.createValidationSession ??
			createPhiAgentSession;
		this.interactiveSession = new InteractiveSession(
			params.runtime,
			params.sessionId
		);
	}

	public async submitInteractive(input: InteractiveInput): Promise<void> {
		try {
			await this.interactiveSession.submit({
				content: buildInteractiveAgentContent(input),
				sendTyping: input.sendTyping,
			});
		} catch (error: unknown) {
			this.params.reloadRegistry.clearPending(this.params.chatId);
			throw error;
		}
		await this.params.reloadRegistry.applyPending(this.params.chatId);
	}

	public async submitCron(input: CronInput): Promise<PhiMessage[]> {
		const outboundMessages: PhiMessage[] = [];
		const session = await this.createCronSession(
			this.params.sessionId,
			this.params.phiConfig,
			{
				persistSession: false,
				extensionFactories: createCronMessagingExtensionFactories({
					sessionId: this.params.sessionId,
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

	public async validateReload(): Promise<string[]> {
		const session = await this.createValidationSession(
			this.params.sessionId,
			this.params.phiConfig,
			{
				persistSession: false,
			}
		);
		try {
			return ["session"];
		} finally {
			session.dispose();
		}
	}

	public invalidate(): void {
		this.interactiveSession.invalidate();
	}

	public dispose(): void {
		this.interactiveSession.dispose();
	}

	private async publishCronResult(
		session: AgentSession,
		outboundMessages: PhiMessage[]
	): Promise<void> {
		const assistantMessage = createPublishedAssistantMessage(
			getLastAssistantMessage(session),
			resolvePublishedAssistantText(outboundMessages)
		);
		await this.params.sessionExecutor.run(
			this.params.sessionId,
			async () => {
				if (assistantMessage) {
					const persistentSession =
						await this.params.runtime.getOrCreateSession(
							this.params.sessionId
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
						this.params.sessionId,
						message
					);
				}
			}
		);
	}

	private async publishCronError(message: string): Promise<void> {
		const errorText = `Cron job failed: ${message}`;
		await this.params.sessionExecutor.run(
			this.params.sessionId,
			async () => {
				const session = await this.params.runtime.getOrCreateSession(
					this.params.sessionId
				);
				const assistantMessage = createAssistantErrorMessage(
					session,
					errorText
				);
				session.sessionManager.appendMessage(assistantMessage);
				session.agent.replaceMessages(
					session.sessionManager.buildSessionContext().messages
				);
				await this.params.routes.deliverOutbound(
					this.params.sessionId,
					{
						text: errorText,
						attachments: [],
					}
				);
			}
		);
	}
}
