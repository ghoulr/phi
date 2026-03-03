import { describe, expect, it } from "bun:test";

import type { AgentSession } from "@mariozechner/pi-coding-agent";

import { runTuiCommand } from "@phi/commands/tui";

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
	it("passes created session into mode runner", async () => {
		const fakeSession = createFakeAgentSession();
		let createCalls = 0;
		let receivedSession: AgentSession | undefined;

		await runTuiCommand(
			async () => {
				createCalls += 1;
				return fakeSession;
			},
			async (session) => {
				receivedSession = session;
			}
		);

		expect(createCalls).toBe(1);
		expect(receivedSession).toBe(fakeSession);
		expect((fakeSession as unknown as FakeSession).disposeCalls).toBe(1);
	});

	it("always disposes the tui session when mode runner fails", async () => {
		const fakeSession = createFakeAgentSession();
		const disposeSpy = fakeSession as unknown as FakeSession;

		await expect(
			runTuiCommand(
				async () => fakeSession,
				async () => {
					throw new Error("tui failed");
				}
			)
		).rejects.toThrow("tui failed");

		expect(disposeSpy.disposeCalls).toBe(1);
	});
});
