import { describe, expect, it } from "bun:test";

import { ChatSessionPool, type DisposableSession } from "@phi/core/runtime";

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

describe("ChatSessionPool", () => {
	it("deduplicates concurrent create calls for the same chat", async () => {
		let createCount = 0;
		let resolveCreation: ((session: FakeSession) => void) | undefined;
		const pool = new ChatSessionPool<FakeSession>(async () => {
			createCount += 1;
			return await new Promise<FakeSession>((resolve) => {
				resolveCreation = resolve;
			});
		});

		const pendingSession1 = pool.getOrCreateSession("user-alice");
		const pendingSession2 = pool.getOrCreateSession("user-alice");
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
		const pool = new ChatSessionPool<FakeSession>(async () => {
			createCount += 1;
			if (shouldFail) {
				throw new Error("creation failed");
			}
			return createFakeSession(`session-${createCount}`);
		});

		await expect(pool.getOrCreateSession("user-alice")).rejects.toThrow(
			"creation failed"
		);

		shouldFail = false;
		const session = await pool.getOrCreateSession("user-alice");
		expect(session.id).toBe("session-2");
		expect(createCount).toBe(2);
	});

	it("returns false when disposing an unknown chat", () => {
		const pool = new ChatSessionPool<FakeSession>(async () =>
			createFakeSession("unused")
		);
		expect(pool.disposeSession("missing")).toBe(false);
	});
});
