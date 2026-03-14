import { describe, expect, it } from "bun:test";

import type {
	AgentSession,
	ExtensionFactory,
} from "@mariozechner/pi-coding-agent";

import type { SessionExecutor } from "@phi/core/session-executor";
import { ChatReloadRegistry } from "@phi/core/reload";
import type { SessionRuntime } from "@phi/core/runtime";
import { ServiceRoutes } from "@phi/services/routes";
import { PiSessionRuntime } from "@phi/services/session";

function createImmediateExecutor(): SessionExecutor {
	return {
		async run<TResult>(
			_key: string,
			handler: () => Promise<TResult>
		): Promise<TResult> {
			return await handler();
		},
	};
}

function createAgentEndEvent(params: {
	text?: string;
	stopReason?: "stop" | "error";
	errorMessage?: string;
}) {
	const content = params.text ? [{ type: "text", text: params.text }] : [];
	return {
		type: "agent_end",
		messages: [
			{
				role: "assistant",
				content,
				stopReason: params.stopReason ?? "stop",
				errorMessage: params.errorMessage,
			},
		],
		message: {
			role: "assistant",
			content,
			stopReason: params.stopReason ?? "stop",
			errorMessage: params.errorMessage,
		},
	};
}

function createExtensionHarness(
	extensionFactories: ExtensionFactory[] | undefined,
	ctx: Record<string, unknown> = {
		cwd: "/tmp",
		sessionManager: { getBranch: () => [] },
	}
) {
	const handlers = new Map<string, (event: unknown) => Promise<void>>();
	let tool:
		| {
				execute: (
					toolCallId: string,
					params: Record<string, unknown>,
					signal?: AbortSignal,
					onUpdate?: unknown,
					ctx?: unknown
				) => Promise<unknown>;
		  }
		| undefined;
	for (const factory of extensionFactories ?? []) {
		factory({
			on(
				name: string,
				handler: (event: unknown, context: unknown) => Promise<void>
			) {
				handlers.set(name, async (event: unknown) => {
					await handler(event, ctx as never);
				});
			},
			registerTool(definition: NonNullable<typeof tool>) {
				tool = definition;
			},
		} as never);
	}
	return { handlers, tool };
}

describe("PiSessionRuntime", () => {
	it("submits interactive text to the runtime session", async () => {
		const contents: unknown[] = [];
		const runtime: SessionRuntime<AgentSession> = {
			async getOrCreateSession(): Promise<AgentSession> {
				return {
					isStreaming: false,
					async sendUserMessage(content: unknown): Promise<void> {
						contents.push(content);
					},
					subscribe() {
						return () => {};
					},
					dispose() {},
				} as unknown as AgentSession;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const session = new PiSessionRuntime({
			sessionId: "alice-telegram",
			chatId: "alice",
			phiConfig: {},
			runtime,
			sessionExecutor: createImmediateExecutor(),
			routes: new ServiceRoutes(),
			reloadRegistry: new ChatReloadRegistry(),
		});

		await session.submitInteractive({
			text: "hello",
			attachments: [],
			sendTyping: async () => ({ ok: true }),
		});

		expect(contents).toEqual(["hello"]);
	});

	it("keeps metadata reminder without outbound destination", async () => {
		const contents: Array<string | Array<{ type: string; text?: string }>> =
			[];
		const runtime: SessionRuntime<AgentSession> = {
			async getOrCreateSession(): Promise<AgentSession> {
				return {
					isStreaming: false,
					async sendUserMessage(content: unknown): Promise<void> {
						contents.push(
							content as
								| string
								| Array<{ type: string; text?: string }>
						);
					},
					subscribe() {
						return () => {};
					},
					dispose() {},
				} as unknown as AgentSession;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const session = new PiSessionRuntime({
			sessionId: "alice-telegram",
			chatId: "alice",
			phiConfig: {},
			runtime,
			sessionExecutor: createImmediateExecutor(),
			routes: new ServiceRoutes(),
			reloadRegistry: new ChatReloadRegistry(),
		});

		await session.submitInteractive({
			text: "hello",
			attachments: [],
			metadata: {
				current_message: {
					from: {
						id: 100,
					},
				},
			},
			sendTyping: async () => ({ ok: true }),
		});

		const content = contents[0];
		expect(Array.isArray(content)).toBeTrue();
		const reminderText = Array.isArray(content)
			? (content[1]?.text ?? "")
			: "";
		expect(reminderText).toContain("current_message:");
		expect(reminderText).not.toContain("outboundDestination");
	});

	it("steers the next interactive submit while the session is streaming", async () => {
		const calls: Array<{
			text: string | undefined;
			deliverAs?: "steer" | "followUp";
		}> = [];
		let releaseFirst: (() => void) | undefined;
		let listener: ((event: unknown) => void) | undefined;
		let streaming = false;
		let secondQueued = false;
		const runtime: SessionRuntime<AgentSession> = {
			async getOrCreateSession(): Promise<AgentSession> {
				return {
					get isStreaming() {
						return streaming;
					},
					subscribe(callback: (event: unknown) => void) {
						listener = callback;
						return () => {
							listener = undefined;
						};
					},
					async sendUserMessage(
						content: unknown,
						options?: { deliverAs?: "steer" | "followUp" }
					): Promise<void> {
						const text =
							typeof content === "string"
								? content
								: Array.isArray(content) &&
										content[0]?.type === "text"
									? content[0].text
									: undefined;
						calls.push({ text, deliverAs: options?.deliverAs });
						if (text === "m1") {
							listener?.({
								type: "message_update",
								message: { role: "assistant" },
								assistantMessageEvent: {
									type: "thinking_delta",
								},
							});
							streaming = true;
							await new Promise<void>((resolve) => {
								releaseFirst = resolve;
							});
							if (secondQueued) {
								listener?.({
									type: "message_update",
									message: { role: "assistant" },
									assistantMessageEvent: {
										type: "text_delta",
									},
								});
							}
							streaming = false;
							return;
						}
						secondQueued = true;
					},
					dispose() {},
				} as unknown as AgentSession;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const session = new PiSessionRuntime({
			sessionId: "alice-telegram",
			chatId: "alice",
			phiConfig: {},
			runtime,
			sessionExecutor: createImmediateExecutor(),
			routes: new ServiceRoutes(),
			reloadRegistry: new ChatReloadRegistry(),
		});

		const first = session.submitInteractive({
			text: "m1",
			attachments: [],
			sendTyping: async () => ({ ok: true }),
		});
		const second = session.submitInteractive({
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
		releaseFirst?.();
		await Promise.all([first, second]);
	});

	it("delivers cron instant sends through the session route", async () => {
		const routes = new ServiceRoutes();
		const delivered: string[] = [];
		routes.registerOutboundRoute("alice-cron", {
			async deliver(message): Promise<void> {
				delivered.push(message.text ?? "");
			},
		});
		const persistentSession = {
			sessionManager: {
				appendMessage() {},
				buildSessionContext() {
					return { messages: [] };
				},
			},
			agent: {
				replaceMessages() {},
			},
		} as unknown as AgentSession;
		const runtime: SessionRuntime<AgentSession> = {
			async getOrCreateSession(): Promise<AgentSession> {
				return persistentSession;
			},
			disposeSession(): boolean {
				return true;
			},
		};
		const session = new PiSessionRuntime({
			sessionId: "alice-cron",
			chatId: "alice",
			phiConfig: {
				chats: { alice: { workspace: "~/alice" } },
				sessions: {
					"alice-cron": {
						chat: "alice",
						agent: "main",
					},
				},
				agents: {
					main: {
						provider: "openai",
						model: "gpt-5-mini",
					},
				},
			},
			runtime,
			sessionExecutor: createImmediateExecutor(),
			routes,
			reloadRegistry: new ChatReloadRegistry(),
			dependencies: {
				async createCronSession(_sessionId, _phiConfig, options) {
					const branchText = "hello";
					const harness = createExtensionHarness(
						options?.extensionFactories,
						{
							cwd: "/tmp",
							sessionManager: {
								getBranch() {
									return [
										{
											type: "message",
											message: {
												role: "user",
												content: [
													{
														type: "text",
														text: branchText,
													},
												],
											},
										},
									];
								},
							},
						}
					);
					return {
						messages: [],
						async sendUserMessage(): Promise<void> {
							await harness.handlers.get("agent_start")?.({
								type: "agent_start",
							});
							await harness.tool?.execute(
								"call-1",
								{ text: "progress", instant: true },
								undefined,
								undefined,
								{ cwd: "/tmp" }
							);
							await harness.handlers.get("agent_end")?.(
								createAgentEndEvent({ text: "NO_REPLY" })
							);
						},
						dispose() {},
					} as unknown as AgentSession;
				},
			},
		});

		await expect(
			session.submitCron({ text: "Summarize status." })
		).resolves.toEqual([]);
		expect(delivered).toEqual(["progress"]);
	});
});
