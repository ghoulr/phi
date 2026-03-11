import { describe, expect, it } from "bun:test";

import type {
	AgentSession,
	AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";

import type { ChatSessionRuntime } from "@phi/core/runtime";
import { ChatSessionBridge } from "@phi/services/chat-session-bridge";

function createAssistantTurnEndEvent(text: string): AgentSessionEvent {
	return {
		type: "assistant_turn_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text }],
		},
		toolResults: [],
	} as unknown as AgentSessionEvent;
}

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

function createBridgeHarness(text: string) {
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
			listener?.(createAssistantTurnEndEvent(text));
			listener?.(createAgentEndEvent(text));
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
	return { runtime };
}

describe("chat session bridge", () => {
	it("resolves plain assistant text when messaging is not managed", async () => {
		const resolved: unknown[] = [];
		const { runtime } = createBridgeHarness("NO_REPLY");
		const bridge = new ChatSessionBridge(runtime, "user-alice", {
			messagingManaged: false,
			onResolved: async (messages) => {
				resolved.push(messages);
			},
		});

		await bridge.submit({
			content: "hello",
			sendTyping: async () => ({ ok: true }),
		});

		expect(resolved).toEqual([[{ text: "NO_REPLY", attachments: [] }]]);
	});

	it("skips plain fallback when messaging is managed", async () => {
		let resolvedCalls = 0;
		const { runtime } = createBridgeHarness("done");
		const bridge = new ChatSessionBridge(runtime, "user-alice", {
			messagingManaged: true,
			onResolved: async () => {
				resolvedCalls += 1;
			},
		});

		await bridge.submit({
			content: "hello",
			sendTyping: async () => ({ ok: true }),
		});

		expect(resolvedCalls).toBe(0);
	});
});
