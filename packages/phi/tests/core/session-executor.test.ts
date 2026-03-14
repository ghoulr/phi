import { describe, expect, it } from "bun:test";

import { InMemorySessionExecutor } from "@phi/core/session-executor";

describe("InMemorySessionExecutor", () => {
	it("runs different sessions concurrently", async () => {
		const executor = new InMemorySessionExecutor();
		const order: string[] = [];
		let releaseAlice: (() => void) | undefined;

		const alice = executor.run("alice", async () => {
			order.push("alice:start");
			await new Promise<void>((resolve) => {
				releaseAlice = resolve;
			});
			order.push("alice:end");
		});
		const bob = executor.run("bob", async () => {
			order.push("bob:start");
			order.push("bob:end");
		});

		await bob;
		expect(order).toEqual(["alice:start", "bob:start", "bob:end"]);

		releaseAlice?.();
		await alice;
		expect(order).toEqual([
			"alice:start",
			"bob:start",
			"bob:end",
			"alice:end",
		]);
	});

	it("serializes tasks for the same session", async () => {
		const executor = new InMemorySessionExecutor();
		const order: string[] = [];
		let releaseFirst: (() => void) | undefined;

		const first = executor.run("alice", async () => {
			order.push("first:start");
			await new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
			order.push("first:end");
		});
		const second = executor.run("alice", async () => {
			order.push("second:start");
			order.push("second:end");
		});

		await Bun.sleep(0);
		expect(order).toEqual(["first:start"]);
		releaseFirst?.();
		await Promise.all([first, second]);
		expect(order).toEqual([
			"first:start",
			"first:end",
			"second:start",
			"second:end",
		]);
	});
});
