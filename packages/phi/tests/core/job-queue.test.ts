import { describe, expect, it } from "bun:test";

import {
	InMemoryJobQueue,
	InMemoryJobQueueProvider,
} from "@phi/core/job-queue";

describe("InMemoryJobQueue", () => {
	it("serializes jobs with the same key", async () => {
		const queue = new InMemoryJobQueue();
		const order: string[] = [];
		let releaseFirst: (() => void) | undefined;

		const first = queue.enqueue("chat-a", async () => {
			order.push("first-start");
			await new Promise<void>((resolve) => {
				releaseFirst = resolve;
			});
			order.push("first-end");
		});
		const second = queue.enqueue("chat-a", async () => {
			order.push("second-start");
			order.push("second-end");
		});

		await Promise.resolve();
		expect(order).toEqual(["first-start"]);

		if (!releaseFirst) {
			throw new Error("First job resolver was not assigned.");
		}
		releaseFirst();

		await Promise.all([first, second]);
		expect(order).toEqual([
			"first-start",
			"first-end",
			"second-start",
			"second-end",
		]);
	});

	it("runs jobs with different keys independently", async () => {
		const queue = new InMemoryJobQueue();
		const order: string[] = [];

		await Promise.all([
			queue.enqueue("chat-a", async () => {
				order.push("a");
			}),
			queue.enqueue("chat-b", async () => {
				order.push("b");
			}),
		]);

		expect(order.sort()).toEqual(["a", "b"]);
	});

	it("continues processing the key queue after a failed job", async () => {
		const queue = new InMemoryJobQueue();
		await expect(
			queue.enqueue("chat-a", async () => {
				throw new Error("job failed");
			})
		).rejects.toThrow("job failed");

		let executed = false;
		await queue.enqueue("chat-a", async () => {
			executed = true;
		});

		expect(executed).toBe(true);
	});

	it("fails fast when queue key is empty", async () => {
		const queue = new InMemoryJobQueue();
		await expect(queue.enqueue("", async () => undefined)).rejects.toThrow(
			"Queue key must not be empty."
		);
	});
});

describe("InMemoryJobQueueProvider", () => {
	it("creates independent queue instances", async () => {
		const provider = new InMemoryJobQueueProvider();
		const queueA = provider.createQueue("a");
		const queueB = provider.createQueue("b");

		let calledA = 0;
		let calledB = 0;
		await queueA.enqueue("chat", async () => {
			calledA += 1;
		});
		await queueB.enqueue("chat", async () => {
			calledB += 1;
		});

		expect(calledA).toBe(1);
		expect(calledB).toBe(1);
	});
});
