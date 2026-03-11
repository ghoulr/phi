import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type {
	AgentSession,
	AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";

import { getPhiLogger } from "@phi/core/logger";
import type { ChatSessionRuntime } from "@phi/core/runtime";
import {
	extractLastAssistantText,
	resolvePlainAssistantMessage,
} from "@phi/messaging/assistant-output";
import type { PhiMessage } from "@phi/messaging/types";

const TYPING_INTERVAL_MS = 2500;
const log = getPhiLogger("chat-session-bridge");

interface TypingNotifier {
	notify(): void;
	stop(): void;
}

interface PendingSubmit {
	typingNotifier: TypingNotifier;
}

export interface ChatSessionBridgeSubmitParams {
	content: string | (TextContent | ImageContent)[];
	sendTyping(): Promise<unknown>;
}

export interface ChatSessionBridgeDependencies {
	messagingManaged: boolean;
	onResolved(messages: PhiMessage[]): Promise<void>;
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

function createPendingSubmit(
	params: Pick<ChatSessionBridgeSubmitParams, "sendTyping">
): PendingSubmit {
	return {
		typingNotifier: createTypingNotifier(params.sendTyping),
	};
}

export class ChatSessionBridge {
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
				log.debug("bridge.submit.steer", {
					chatId: this.chatId,
					pendingSubmitCount: this.pendingSubmissions.length,
				});
				sendPromise = session.sendUserMessage(params.content, {
					deliverAs: "steer",
				});
				return;
			}
			log.debug("bridge.submit.idle", {
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
				async () => await this.handleSessionEvent(session, event),
				async () => await this.handleSessionEvent(session, event)
			);
		});
	}

	private detachSession(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.session = undefined;
	}

	private async handleSessionEvent(
		_session: AgentSession,
		event: AgentSessionEvent
	): Promise<void> {
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
