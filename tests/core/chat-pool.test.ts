import { describe, expect, it } from "bun:test";

import { ChatSessionPool, type DisposableSession } from "@phi/core/chat-pool";

class TestSession implements DisposableSession {
	public disposed = false;

	public constructor(public readonly id: number) {}

	public dispose(): void {
		this.disposed = true;
	}
}

describe("ChatSessionPool", () => {
	it("recreates a session after invalidation", async () => {
		let nextId = 0;
		const pool = new ChatSessionPool(async () => new TestSession(++nextId));

		const first = await pool.getOrCreateSession("alice");
		pool.invalidateSession("alice");
		const second = await pool.getOrCreateSession("alice");

		expect(first.id).toBe(1);
		expect(first.disposed).toBe(true);
		expect(second.id).toBe(2);
	});
});
