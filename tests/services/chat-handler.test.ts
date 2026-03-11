import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import type {
	AgentSession,
	AgentSessionEvent,
	ExtensionFactory,
} from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ChatExecutor } from "@phi/core/chat-executor";
import type {
	ChatSessionRuntime,
	CreatePhiAgentSessionOptions,
} from "@phi/core/runtime";
import type { PhiConfig } from "@phi/core/config";
import {
	PiChatHandler,
	createServiceSessionExtensionFactories,
} from "@phi/services/chat-handler";
import { ServiceRoutes } from "@phi/services/routes";

function createAgentEndEvent(text: string): AgentSessionEvent {
	return {
		type: "agent_end",
		messages: [
			{
				role: "assistant",
				content: [{ type: "text", text }],
			},
		],
	} as unknown as AgentSessionEvent;
}

function createMessageUpdateEvent(
	type: "thinking_delta" | "text_delta"
): AgentSessionEvent {
	return {
		type: "message_update",
		message: { role: "assistant" },
		assistantMessageEvent: { type },
	} as unknown as AgentSessionEvent;
}

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5.2",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createImmediateExecutor(): ChatExecutor {
	return {
		async run<TResult>(
			_chatId: string,
			handler: () => Promise<TResult>
		): Promise<TResult> {
			return await handler();
		},
	};
}

interface MessagingExtensionHarness {
	handlers: Map<string, (event: unknown) => Promise<void>>;
	sendTool?: {
		execute: (
			toolCallId: string,
			params: Record<string, unknown>,
			signal?: AbortSignal,
			onUpdate?: unknown,
			ctx?: unknown
		) => Promise<unknown>;
	};
	ctx: {
		cwd: string;
		sessionManager: {
			getBranch(): Array<{
				type: "message";
				message: {
					role: "user";
					content: Array<{ type: "text"; text: string }>;
				};
			}>;
		};
	};
}

function createMessagingExtensionHarness(
	factory: ExtensionFactory,
	workspace: string,
	userText: string = "cron prompt"
): MessagingExtensionHarness {
	const handlers = new Map<string, (event: unknown) => Promise<void>>();
	const harness: MessagingExtensionHarness = {
		handlers,
		ctx: {
			cwd: workspace,
			sessionManager: {
				getBranch() {
					return [
						{
							type: "message",
							message: {
								role: "user",
								content: [{ type: "text", text: userText }],
							},
						},
					];
				},
			},
		},
	};
	factory({
		on(
			name: string,
			handler: (event: unknown, ctx: unknown) => Promise<void>
		) {
			handlers.set(name, async (event: unknown) => {
				await handler(event, harness.ctx as never);
			});
		},
		registerTool(
			definition: NonNullable<MessagingExtensionHarness["sendTool"]>
		) {
			harness.sendTool = definition;
		},
	} as never);
	return harness;
}

function createFakeCronSessionFactory(params: {
	workspace: string;
	runTurn(harness: MessagingExtensionHarness): Promise<string>;
}) {
	return async (
		_chatId: string,
		_phiConfig: PhiConfig,
		options: CreatePhiAgentSessionOptions = {}
	): Promise<AgentSession> => {
		const factory = options.extensionFactories?.[0];
		if (!factory) {
			throw new Error("Missing messaging extension factory");
		}
		const harness = createMessagingExtensionHarness(
			factory,
			params.workspace
		);
		let assistantText = "";
		const state = {
			messages: [] as AssistantMessage[],
		};
		const session = {
			get messages() {
				return state.messages;
			},
			async sendUserMessage(): Promise<void> {
				await harness.handlers.get("agent_start")?.({
					type: "agent_start",
				});
				assistantText = await params.runTurn(harness);
				state.messages = [createAssistantMessage(assistantText)];
				await harness.handlers.get("agent_end")?.({
					type: "agent_end",
					messages: [
						{
							role: "assistant",
							content: [{ type: "text", text: assistantText }],
						},
					],
				});
			},
			dispose(): void {},
		};
		return session as unknown as AgentSession;
	};
}

describe("chat handler", () => {
	it("delivers fallback assistant text when messaging is not managed", async () => {
		let listener: ((event: AgentSessionEvent) => void) | undefined;
		const session = {
			isStreaming: false,
			subscribe(handler: (event: AgentSessionEvent) => void) {
				listener = handler;
				return () => {
					listener = undefined;
				};
			},
			async sendUserMessage(): Promise<void> {
				listener?.(createAgentEndEvent("NO_REPLY"));
			},
			dispose(): void {},
		} as unknown as AgentSession;
		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession() {
				return session;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const routes = new ServiceRoutes();
		const delivered: string[] = [];
		routes.registerOutboundRoute("alice", {
			async deliver(message): Promise<void> {
				delivered.push(message.text ?? "");
			},
		});

		const handler = new PiChatHandler({
			chatId: "alice",
			phiConfig: {
				chats: { alice: { workspace: "~/alice", agent: "main" } },
			},
			runtime,
			chatExecutor: createImmediateExecutor(),
			routes,
			dependencies: { messagingManaged: false },
		});

		await handler.submitInteractive({
			text: "hello",
			attachments: [],
			sendTyping: async () => ({ ok: true }),
		});

		expect(delivered).toEqual(["NO_REPLY"]);
	});

	it("skips fallback assistant delivery when messaging is managed", async () => {
		let listener: ((event: AgentSessionEvent) => void) | undefined;
		const session = {
			isStreaming: false,
			subscribe(handler: (event: AgentSessionEvent) => void) {
				listener = handler;
				return () => {
					listener = undefined;
				};
			},
			async sendUserMessage(): Promise<void> {
				listener?.(createAgentEndEvent("done"));
			},
			dispose(): void {},
		} as unknown as AgentSession;
		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession() {
				return session;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const routes = new ServiceRoutes();
		const delivered: string[] = [];
		routes.registerOutboundRoute("alice", {
			async deliver(message): Promise<void> {
				delivered.push(message.text ?? "");
			},
		});

		const handler = new PiChatHandler({
			chatId: "alice",
			phiConfig: {
				chats: { alice: { workspace: "~/alice", agent: "main" } },
			},
			runtime,
			chatExecutor: createImmediateExecutor(),
			routes,
		});

		await handler.submitInteractive({
			text: "hello",
			attachments: [],
			sendTyping: async () => ({ ok: true }),
		});

		expect(delivered).toEqual([]);
	});

	it("shapes interactive attachments inside the chat handler", async () => {
		const root = mkdtempSync(join(tmpdir(), "phi-chat-handler-"));
		try {
			const imagePath = join(root, "image.jpg");
			writeFileSync(imagePath, new Uint8Array([1, 2, 3]));
			let sentContent: unknown;
			const session = {
				isStreaming: false,
				subscribe() {
					return () => {};
				},
				async sendUserMessage(content: unknown): Promise<void> {
					sentContent = content;
				},
				dispose(): void {},
			} as unknown as AgentSession;
			const runtime: ChatSessionRuntime<AgentSession> = {
				async getOrCreateSession() {
					return session;
				},
				disposeSession(): boolean {
					return true;
				},
			};
			const handler = new PiChatHandler({
				chatId: "alice",
				phiConfig: {
					chats: { alice: { workspace: root, agent: "main" } },
				},
				runtime,
				chatExecutor: createImmediateExecutor(),
				routes: new ServiceRoutes(),
				dependencies: { messagingManaged: false },
			});

			await handler.submitInteractive({
				text: "see image",
				attachments: [
					{
						path: imagePath,
						name: "image.jpg",
						mimeType: "image/jpeg",
					},
				],
				metadata: {
					current_message: {
						message_id: 10,
					},
				},
				sendTyping: async () => ({ ok: true }),
			});

			expect(Array.isArray(sentContent)).toBe(true);
			const parts = sentContent as Array<Record<string, unknown>>;
			expect(parts[0]).toEqual({
				type: "text",
				text: expect.stringContaining("see image"),
			});
			const firstText = parts[0]?.text;
			if (typeof firstText !== "string") {
				throw new Error("Missing first text part");
			}
			expect(firstText).toContain(imagePath);
			expect(parts[1]).toEqual({
				type: "image",
				mimeType: "image/jpeg",
				data: "AQID",
			});
			expect(parts.at(-1)).toEqual({
				type: "text",
				text: expect.stringContaining("<system-reminder>"),
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("steers the next interactive submit while the session is streaming", async () => {
		let listener: ((event: AgentSessionEvent) => void) | undefined;
		let releaseFirst: (() => void) | undefined;
		let streaming = false;
		let secondQueued = false;
		const calls: Array<{ text: string; deliverAs?: string }> = [];
		const session = {
			get isStreaming() {
				return streaming;
			},
			subscribe(handler: (event: AgentSessionEvent) => void) {
				listener = handler;
				return () => {
					listener = undefined;
				};
			},
			async sendUserMessage(
				content: string,
				options?: { deliverAs?: "steer" | "followUp" }
			): Promise<void> {
				calls.push({ text: content, deliverAs: options?.deliverAs });
				if (content === "m1") {
					listener?.(createMessageUpdateEvent("thinking_delta"));
					streaming = true;
					await new Promise<void>((resolve) => {
						releaseFirst = resolve;
					});
					if (secondQueued) {
						listener?.(createMessageUpdateEvent("text_delta"));
					}
					listener?.(createAgentEndEvent("done"));
					streaming = false;
					return;
				}
				secondQueued = true;
			},
			dispose(): void {},
		} as unknown as AgentSession;
		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession() {
				return session;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const handler = new PiChatHandler({
			chatId: "alice",
			phiConfig: {
				chats: { alice: { workspace: "~/alice", agent: "main" } },
			},
			runtime,
			chatExecutor: createImmediateExecutor(),
			routes: new ServiceRoutes(),
			dependencies: { messagingManaged: false },
		});

		const first = handler.submitInteractive({
			text: "m1",
			attachments: [],
			sendTyping: async () => ({ ok: true }),
		});
		const second = handler.submitInteractive({
			text: "m2",
			attachments: [],
			sendTyping: async () => ({ ok: true }),
		});
		for (let attempt = 0; attempt < 10 && calls.length < 2; attempt += 1) {
			await Promise.resolve();
		}
		expect(calls).toEqual([
			{ text: "m1", deliverAs: undefined },
			{ text: "m2", deliverAs: "steer" },
		]);
		if (!releaseFirst) {
			throw new Error("Missing first submit release");
		}
		releaseFirst();
		await Promise.all([first, second]);
	});

	it("delivers cron instant sends immediately and skips history for NO_REPLY", async () => {
		const routes = new ServiceRoutes();
		const delivered: string[] = [];
		routes.registerOutboundRoute("alice", {
			async deliver(message): Promise<void> {
				delivered.push(message.text ?? "");
			},
		});
		let resolveDelivered: (() => void) | undefined;
		const deliveredSignal = new Promise<void>((resolve) => {
			resolveDelivered = resolve;
		});
		routes.registerOutboundRoute("alice", {
			async deliver(message): Promise<void> {
				if (message.text === "progress") {
					resolveDelivered?.();
				}
			},
		});
		let runtimeCalls = 0;
		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession(): Promise<AgentSession> {
				runtimeCalls += 1;
				throw new Error("should not publish history");
			},
			disposeSession(): boolean {
				return true;
			},
		};
		let finishTurn: (() => void) | undefined;
		const finishTurnPromise = new Promise<void>((resolve) => {
			finishTurn = resolve;
		});
		const handler = new PiChatHandler({
			chatId: "alice",
			phiConfig: {
				chats: { alice: { workspace: "/tmp/alice", agent: "main" } },
			},
			runtime,
			chatExecutor: createImmediateExecutor(),
			routes,
			dependencies: {
				createCronSession: createFakeCronSessionFactory({
					workspace: "/tmp/alice",
					async runTurn(harness): Promise<string> {
						if (!harness.sendTool) {
							throw new Error("Missing send tool");
						}
						await harness.sendTool.execute(
							"call-1",
							{ text: "progress", instant: true },
							undefined,
							undefined,
							harness.ctx
						);
						await finishTurnPromise;
						return "NO_REPLY";
					},
				}),
			},
		});

		const resultPromise = handler.submitCron({ text: "cron prompt" });
		await deliveredSignal;
		expect(delivered).toEqual(["progress"]);
		finishTurn?.();
		expect(await resultPromise).toEqual([]);
		expect(runtimeCalls).toBe(0);
	});

	it("publishes cron final output back to the persistent chat session", async () => {
		const delivered: string[] = [];
		const routes = new ServiceRoutes();
		routes.registerOutboundRoute("alice", {
			async deliver(message): Promise<void> {
				delivered.push(message.text ?? "");
			},
		});
		const appended: AssistantMessage[] = [];
		const replacedMessages: unknown[] = [];
		const persistentSession = {
			model: {
				api: "openai-responses",
				provider: "openai",
				id: "gpt-5.2",
			},
			sessionManager: {
				appendMessage(message: AssistantMessage) {
					appended.push(message);
				},
				buildSessionContext() {
					return { messages: appended };
				},
			},
			agent: {
				replaceMessages(messages: unknown) {
					replacedMessages.push(messages);
				},
			},
			subscribe() {
				return () => {};
			},
			dispose(): void {},
		} as unknown as AgentSession;
		const runtime: ChatSessionRuntime<AgentSession> = {
			async getOrCreateSession() {
				return persistentSession;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const handler = new PiChatHandler({
			chatId: "alice",
			phiConfig: {
				chats: { alice: { workspace: "/tmp/alice", agent: "main" } },
			},
			runtime,
			chatExecutor: createImmediateExecutor(),
			routes,
			dependencies: {
				createCronSession: createFakeCronSessionFactory({
					workspace: "/tmp/alice",
					async runTurn(): Promise<string> {
						return "done";
					},
				}),
			},
		});

		expect(await handler.submitCron({ text: "cron prompt" })).toEqual([
			{ text: "done", attachments: [] },
		]);
		expect(delivered).toEqual(["done"]);
		expect(appended).toHaveLength(1);
		expect(appended[0]?.content).toEqual([{ type: "text", text: "done" }]);
		expect(replacedMessages).toHaveLength(1);
	});

	it("creates service session extensions that route visible messages", async () => {
		const routes = new ServiceRoutes();
		const delivered: string[] = [];
		routes.registerOutboundRoute("alice", {
			async deliver(message): Promise<void> {
				delivered.push(message.text ?? "");
			},
		});
		const [factory] = createServiceSessionExtensionFactories(
			"alice",
			routes
		);
		if (!factory) {
			throw new Error("Missing service session extension factory");
		}
		const harness = createMessagingExtensionHarness(factory, "/tmp/alice");
		if (!harness.sendTool) {
			throw new Error("Missing send tool");
		}

		await harness.handlers.get("agent_start")?.({ type: "agent_start" });
		await harness.sendTool.execute(
			"call-1",
			{ text: "done", instant: true },
			undefined,
			undefined,
			harness.ctx
		);

		expect(delivered).toEqual(["done"]);
	});
});
