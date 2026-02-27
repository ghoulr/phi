import { describe, expect, it } from "bun:test";

import { ConversationRuntime, type DisposableSession } from "@phi/core/runtime";

type FakeSession = DisposableSession & {
	id: string;
	disposeCalls: number;
};

function createFakeSession(id: string): FakeSession {
	return {
		id,
		disposeCalls: 0,
		dispose() {
			this.disposeCalls += 1;
		},
	};
}

describe("ConversationRuntime", () => {
	it("deduplicates concurrent create calls for the same conversation key", async () => {
		let createCount = 0;
		let resolveCreation: ((session: FakeSession) => void) | undefined;
		const runtime = new ConversationRuntime<FakeSession>(async () => {
			createCount += 1;
			return await new Promise<FakeSession>((resolve) => {
				resolveCreation = resolve;
			});
		});

		const pendingSession1 = runtime.getOrCreateSession("telegram:chat-1");
		const pendingSession2 = runtime.getOrCreateSession("telegram:chat-1");
		expect(createCount).toBe(1);

		if (!resolveCreation) {
			throw new Error("Session creation resolver was not assigned.");
		}
		resolveCreation(createFakeSession("s1"));

		const [session1, session2] = await Promise.all([
			pendingSession1,
			pendingSession2,
		]);
		expect(session1).toBe(session2);
	});

	it("retries session creation after a failed creation", async () => {
		let createCount = 0;
		let shouldFail = true;
		const runtime = new ConversationRuntime<FakeSession>(async () => {
			createCount += 1;
			if (shouldFail) {
				throw new Error("creation failed");
			}
			return createFakeSession(`session-${createCount}`);
		});

		await expect(runtime.getOrCreateSession("tui:default")).rejects.toThrow(
			"creation failed"
		);

		shouldFail = false;
		const session = await runtime.getOrCreateSession("tui:default");
		expect(session.id).toBe("session-2");
		expect(createCount).toBe(2);
	});

	it("returns false when disposing an unknown session key", () => {
		const runtime = new ConversationRuntime<FakeSession>(async () =>
			createFakeSession("unused")
		);
		expect(runtime.disposeSession("missing")).toBe(false);
	});
});
