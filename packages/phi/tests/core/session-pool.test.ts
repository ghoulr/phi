import { describe, expect, it } from "bun:test";

import { SessionPool, type DisposableSession } from "@phi/core/session-pool";

class TestSession implements DisposableSession {
	public disposed = false;

	public constructor(public readonly id: number) {}

	public dispose(): void {
		this.disposed = true;
	}
}

describe("SessionPool", () => {
	it("recreates a session after invalidation", async () => {
		let nextId = 0;
		const pool = new SessionPool(async () => new TestSession(++nextId));

		const first = await pool.getOrCreateSession("alice");
		pool.invalidateSession("alice");
		const second = await pool.getOrCreateSession("alice");

		expect(first.id).toBe(1);
		expect(first.disposed).toBe(true);
		expect(second.id).toBe(2);
	});
});
