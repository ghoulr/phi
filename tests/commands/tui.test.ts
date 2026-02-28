import { describe, expect, it } from "bun:test";

import type { AgentSession } from "@mariozechner/pi-coding-agent";

import { runTuiCommand, TUI_CONVERSATION_KEY } from "@phi/commands/tui";
import { PhiRuntime } from "@phi/core/runtime";

type FakeSession = {
	disposeCalls: number;
	dispose(): void;
};

function createFakeAgentSession(): AgentSession {
	const session: FakeSession = {
		disposeCalls: 0,
		dispose() {
			this.disposeCalls += 1;
		},
	};
	return session as unknown as AgentSession;
}

describe("runTuiCommand", () => {
	it("passes agent session into mode runner for the selected agent", async () => {
		const fakeSession = createFakeAgentSession();
		const createdForAgents: string[] = [];
		const runtime = new PhiRuntime<AgentSession>(
			async (agentId: string) => {
				createdForAgents.push(agentId);
				return fakeSession;
			}
		);
		let receivedSession: AgentSession | undefined;

		await runTuiCommand(runtime, "support", async (session) => {
			receivedSession = session;
		});

		expect(receivedSession).toBe(fakeSession);
		expect(createdForAgents).toEqual(["support"]);
	});

	it("always disposes the tui session when mode runner fails", async () => {
		const fakeSession = createFakeAgentSession();
		const runtime = new PhiRuntime<AgentSession>(async () => fakeSession);
		const disposeSpy = fakeSession as unknown as FakeSession;

		await expect(
			runTuiCommand(runtime, "main", async () => {
				throw new Error("tui failed");
			})
		).rejects.toThrow("tui failed");

		expect(disposeSpy.disposeCalls).toBe(1);
		expect(runtime.disposeSession("main", TUI_CONVERSATION_KEY)).toBe(
			false
		);
	});
});
